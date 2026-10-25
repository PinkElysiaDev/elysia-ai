/**
 * 自定义协议引擎单元测试：路径、Match、模板、编译、响应映射、流解码。
 * 对齐 Go custom_mapping.go / custom_match.go / custom_protocol.go 的行为契约。
 */

import { describe, expect, it } from 'vitest'
import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import {
  canonicalJSONStringify,
  customEmptyValue,
  customLookupPath,
  deleteCustomPathForce,
  parseCustomPath,
  setCustomPath,
} from './paths.js'
import {
  customJSONValuesEqual,
  customMatchEval,
  evalMatchAll,
  MATCH_OP_EQUALS,
  validateCustomProtocolMatch,
} from './match.js'
import {
  compileCustomProtocolBody,
  effectiveCustomProtocolResponse,
  extractResponseBodyFields,
} from './compile.js'
import { maheshvaraTemplateContext, renderCustomString, renderCustomTemplate } from './template.js'
import { resolveCustomMapping, customProtocolResponseFromRoot } from './response.js'
import { CustomProtocolStreamDecoder } from './stream.js'
import { registerCustomProtocol, getCustomProtocol } from './registry.js'
import { normalizeCustomProtocolType } from './validate.js'
import type { CustomProtocolConfig } from './types.js'

function sse(event: string, data: string) {
  return { event, data, id: '', retryMs: undefined } as const
}

describe('路径引擎', () => {
  it('解析点路径与数组下标', () => {
    const tokens = parseCustomPath('choices[0].delta.tool_calls')
    expect(tokens).toEqual([{ name: 'choices' }, { index: 0 }, { name: 'delta' }, { name: 'tool_calls' }])
  })

  it('支持引号键名', () => {
    const tokens = parseCustomPath(`$['weird key'][0]`)
    expect(tokens).toEqual([{ name: 'weird key' }, { index: 0 }])
  })

  it('lookup 未命中与越界', () => {
    expect(customLookupPath({ a: { b: 1 } }, 'a.b')).toEqual({ value: 1, found: true })
    expect(customLookupPath({ a: [1, 2] }, 'a[5]').found).toBe(false)
    expect(customLookupPath({ a: 1 }, 'a.b').found).toBe(false)
  })

  it('setCustomPath 按需建容器', () => {
    const root: Record<string, unknown> = {}
    setCustomPath(root, 'usage.input[1]', 5)
    expect(root).toEqual({ usage: { input: [null, 5] } })
  })

  it('deleteCustomPathForce 修剪空父容器', () => {
    const root = { keep: 1, outer: { inner: { x: 1 } } }
    const updated = deleteCustomPathForce(root, 'outer.inner.x') as Record<string, unknown>
    expect(updated).toEqual({ keep: 1 })
  })

  it('customEmptyValue：false/0 非空，空白串/空容器为空', () => {
    expect(customEmptyValue(false)).toBe(false)
    expect(customEmptyValue(0)).toBe(false)
    expect(customEmptyValue('  ')).toBe(true)
    expect(customEmptyValue([])).toBe(true)
    expect(customEmptyValue({})).toBe(true)
    expect(customEmptyValue(undefined)).toBe(true)
  })

  it('canonicalJSONStringify 键排序后可比较', () => {
    expect(canonicalJSONStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
    expect(customJSONValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(customJSONValuesEqual([1, 2], [2, 1])).toBe(false)
  })
})

describe('Match 条件原语', () => {
  const root = { n: 3, s: 'hello world', b: false, arr: [1, 2], o: { k: 'v' }, z: null }

  it('缺省 nonEmpty 与显式 op', () => {
    expect(customMatchEval(root, { path: 'n' })).toBe(true)
    expect(customMatchEval(root, { path: 'missing' })).toBe(false)
    expect(customMatchEval(root, { path: 'z', op: 'isNull' })).toBe(true)
    expect(customMatchEval(root, { path: 'missing', op: 'isNull' })).toBe(true)
    expect(customMatchEval(root, { path: 'o', op: 'notNull' })).toBe(true)
  })

  it('equals/notEquals 类型化', () => {
    expect(customMatchEval(root, { path: 'n', op: 'equals', value: 3 })).toBe(true)
    expect(customMatchEval(root, { path: 'n', op: 'equals', value: '3' })).toBe(false)
    expect(customMatchEval(root, { path: 'o', op: 'equals', value: { k: 'v' } })).toBe(true)
    expect(customMatchEval(root, { path: 'n', op: 'notEquals', value: 4 })).toBe(true)
  })

  it('in/notIn/contains/数值比较', () => {
    expect(customMatchEval(root, { path: 'n', op: 'in', value: [1, 3, 5] })).toBe(true)
    expect(customMatchEval(root, { path: 'n', op: 'notIn', value: [1, 2] })).toBe(true)
    expect(customMatchEval(root, { path: 's', op: 'contains', value: 'lo wo' })).toBe(true)
    expect(customMatchEval(root, { path: 'n', op: 'gte', value: 3 })).toBe(true)
    expect(customMatchEval(root, { path: 'n', op: 'lt', value: 3 })).toBe(false)
  })

  it('isTrue/isFalse：缺失按 false', () => {
    expect(customMatchEval(root, { path: 'b', op: 'isTrue' })).toBe(false)
    expect(customMatchEval(root, { path: 'b', op: 'isFalse' })).toBe(true)
    expect(customMatchEval(root, { path: 'missing', op: 'isFalse' })).toBe(true)
    expect(customMatchEval(root, { path: 'missing', op: 'isTrue' })).toBe(false)
  })

  it('isEmpty 把 false/0 视为空（Match 语境）', () => {
    expect(customMatchEval({ x: 0 }, { path: 'x', op: 'isEmpty' })).toBe(true)
    expect(customMatchEval({ x: false }, { path: 'x', op: 'isEmpty' })).toBe(true)
    expect(customMatchEval({ x: 'a' }, { path: 'x', op: 'isEmpty' })).toBe(false)
  })

  it('MatchSet AND 语义（Gemini thought 过滤的形态）', () => {
    const set = [{ path: 'thought', op: 'isFalse' }, { path: 'functionCall', op: 'isNull' }]
    expect(evalMatchAll({ text: 'hi' }, set)).toBe(true)
    expect(evalMatchAll({ text: 'hi', thought: true }, set)).toBe(false)
    expect(evalMatchAll({ text: 'hi', functionCall: { name: 'f' } }, set)).toBe(false)
  })

  it('校验：未知 op / 缺 value / in 非数组', () => {
    expect(() => validateCustomProtocolMatch('t', { path: 'a', op: 'wat' })).toThrow()
    expect(() => validateCustomProtocolMatch('t', { path: 'a', op: 'equals' })).toThrow()
    expect(() => validateCustomProtocolMatch('t', { path: 'a', op: 'in', value: 3 })).toThrow()
    expect(() => validateCustomProtocolMatch('t', { path: '', op: 'equals', value: 1 })).toThrow()
  })
})

describe('模板引擎', () => {
  const ctx = {
    maheshvara: {
      model: 'm1',
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      flag: true,
      text: 'v',
    },
    request: {},
  } as unknown as Record<string, unknown>

  it('引号内占位符按字符串转义嵌入，裸占位符按 JSON 值嵌入', () => {
    const rendered = renderCustomTemplate(
      '{"model": "{{maheshvara.model}}", "temp": {{maheshvara.temperature}}, "flag": {{maheshvara.flag}}, "arr": {{maheshvara.messages}}}',
      ctx,
      [],
      [],
    ) as Record<string, unknown>
    expect(rendered['model']).toBe('m1')
    expect(rendered['temp']).toBe(0.5)
    expect(rendered['flag']).toBe(true)
    expect(rendered['arr']).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('default 过滤器与缺失值嵌 null', () => {
    const rendered = renderCustomTemplate(
      '{"a": {{maheshvara.missing | default:42}}, "b": {{maheshvara.missing}}}',
      ctx,
      [],
      [],
    ) as Record<string, unknown>
    expect(rendered['a']).toBe(42)
    expect(rendered['b']).toBe(null)
  })

  it('omitIfEmpty 渲染后删除空值路径并修剪父容器', () => {
    const rendered = renderCustomTemplate(
      '{"model": "{{maheshvara.model}}", "tools": {{maheshvara.no_tools}}}',
      ctx,
      ['tools'],
      [],
    ) as Record<string, unknown>
    expect(rendered).toEqual({ model: 'm1' })
  })

  it('when/omitIf 条件省略规则', () => {
    const rendered = renderCustomTemplate(
      '{"model": "{{maheshvara.model}}", "x": 1}',
      ctx,
      [],
      [{ path: 'x', field: 'x', when: { path: 'maheshvara.flag', op: 'isTrue' } }],
    ) as Record<string, unknown>
    // when 成立（flag isTrue）→ 不省略
    expect(rendered['x']).toBe(1)

    const renderedOmitted = renderCustomTemplate(
      '{"model": "{{maheshvara.model}}", "x": 1}',
      ctx,
      [],
      [{ path: 'x', field: 'x', when: { path: 'maheshvara.flag', op: 'isFalse' } }],
    ) as Record<string, unknown>
    expect('x' in renderedOmitted).toBe(false)

    const omitIfHit = renderCustomTemplate(
      '{"v": {{maheshvara.temperature}}}',
      ctx,
      [],
      [{ path: 'v', field: 'temperature', omitIf: 0.5 }],
    ) as Record<string, unknown>
    expect('v' in omitIfHit).toBe(false)
  })

  it('字符串模板（路径渲染）', () => {
    expect(renderCustomString('/v1beta/models/{{maheshvara.model}}:generateContent', ctx)).toBe('/v1beta/models/m1:generateContent')
    // 合法路径缺失 → 空串；非法选项 → 占位符原样保留（Go renderCustomString）。
    expect(renderCustomString('bad {{missing.path}} ok', ctx)).toBe('bad  ok')
    expect(renderCustomString('bad {{x|wat}} ok', ctx)).toBe('bad {{x|wat}} ok')
  })

  it('模板上下文剥离 RawExtra 并回填 raw_extra/extra', () => {
    const req = {
      model: 'm',
      RawExtra: { vendor_x: 1 },
    } as unknown as MaheshvaraRequest
    const context = maheshvaraTemplateContext(req)
    const root = context['maheshvara'] as Record<string, unknown>
    expect('RawExtra' in root).toBe(false)
    expect(root['raw_extra']).toEqual({ vendor_x: 1 })
    expect(root['extra']).toEqual({ vendor_x: 1 })
  })
})

describe('请求体注解树编译', () => {
  it('树编译为模板并收集 omit/规则', () => {
    const compiled = compileCustomProtocolBody({
      model: { field: 'model', mode: 'string' },
      messages: { field: 'messages' },
      stream: { field: 'stream' },
      max_tokens: { field: 'max_output_tokens', omitIfEmpty: true },
      nested: { deep: { field: 'thinking.enabled', when: { path: 'thinking.enabled', op: 'isTrue' } } },
      constant: { value: [1, 2] },
    })
    expect(compiled.template).toContain('"max_tokens": {{maheshvara.max_output_tokens}}')
    expect(compiled.template).toContain('"model": "{{maheshvara.model}}"')
    expect(compiled.template).toContain('maheshvara.thinking.enabled')
    expect(compiled.omitIfEmpty).toEqual(['max_tokens'])
    expect(compiled.omitRules).toHaveLength(1)
    expect(compiled.omitRules[0].when?.path).toBe('maheshvara.thinking.enabled')
  })

  it('未知字段与注解键误用报错', () => {
    expect(() => compileCustomProtocolBody({ x: { field: 'no_such_field' } })).toThrow(/unknown Maheshvara field/)
    expect(() => compileCustomProtocolBody({ x: { mode: 'string' } })).toThrow(/missing "field"/)
    expect(() => compileCustomProtocolBody({ x: { field: 'model', extra: 1 } })).toThrow(/unknown key/)
  })

  it('返回体构造树提取字段映射（含特殊键名路径）', () => {
    const fields = extractResponseBodyFields('response', {
      id: { field: 'id' },
      choices: [{ message: { field: 'text' } }],
      'weird key': { field: 'reasoning' },
      placeholder: { value: 'x' },
    })
    // 对象键按字典序遍历（Go sort.Strings），路径 $ 根起；
    // 非标识符键名（含空格）用 ['key'] 形式（连字符在标识符集内）。
    expect(fields.map((f) => [f.field, f.path])).toEqual([
      ['text', '$.choices[0].message'],
      ['id', '$.id'],
      ['reasoning', "$['weird key']"],
    ])
  })

  it('fields 行映射编译为直接路径与 usage.* int 行', () => {
    const compiled = effectiveCustomProtocolResponse('response', {
      fields: [
        { path: 'choices[0].text', field: 'text' },
        { path: 'u.in', field: 'usage.input_tokens' },
        { path: 'meta.v', field: 'metadata.vendor' },
      ],
    })
    expect(compiled.textPath).toBe('choices[0].text')
    expect(compiled.fieldMappings).toEqual([
      { target: 'usage.input_tokens', source: 'u.in', transform: 'int' },
      { target: 'metadata.vendor', source: 'meta.v' },
    ])
  })
})

describe('响应映射', () => {
  it('文本过滤 + 工具别名 + 用量别名 + fieldMappings', () => {
    const config: CustomProtocolConfig = {
      id: 't',
      request: { path: '/x' },
      response: {
        textPath: 'content',
        textFilter: { path: 'type', op: 'equals', value: 'text' },
        toolCallsPath: 'content',
        usagePath: 'u',
        fieldMappings: [{ target: 'metadata.vendor', source: 'vendor' }],
      },
      aliases: {
        toolCall: { arguments: ['input'] },
        usage: { input: ['promptTokenCount'] },
      },
    }
    const resolved = resolveCustomMapping(config, false)
    const response = customProtocolResponseFromRoot(
      {
        content: [
          { type: 'text', text: 'A' },
          { type: 'thinking', thinking: 'B' },
          { type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } },
        ],
        u: { promptTokenCount: 9, completion_tokens: 4 },
        vendor: 'acme',
      },
      resolved,
      config.aliases,
      't',
      false,
    )
    const text = response.output?.find((item) => item.type === 'message')
    expect(text?.content?.[0]?.text).toBe('A')
    const call = response.output?.find((item) => item.type === 'function_call')
    expect(call?.name).toBe('f')
    expect(call?.arguments).toBe('{"a":1}')
    expect(response.usage).toMatchObject({ input_tokens: 9, output_tokens: 4, total_tokens: 13 })
    expect(response.metadata).toEqual({ vendor: 'acme' })
  })

  it('allowEmpty=false 时无可映射输出报错', () => {
    const config: CustomProtocolConfig = {
      id: 't2',
      request: { path: '/x' },
      response: { textPath: 'content' },
    }
    const resolved = resolveCustomMapping(config, false)
    expect(() => customProtocolResponseFromRoot({ other: 1 }, resolved, undefined, 't2', false)).toThrow(/no mapped text/)
    expect(() => customProtocolResponseFromRoot({ other: 1 }, resolved, undefined, 't2', true)).not.toThrow()
  })
})

describe('流解码器', () => {
  it('done 值、帧跳过、delta 累计与终止', () => {
    const config: CustomProtocolConfig = {
      id: 's',
      request: { path: '/x' },
      response: {
        stream: {
          mode: 'delta',
          frames: [
            { event: 'text', response: { textPath: 'd.text' } },
            { event: 'done', terminal: true },
          ],
        },
      },
    }
    const decoder = new CustomProtocolStreamDecoder(config)
    const e1 = decoder.decode(sse('text', '{"d":{"text":"he"}}'))
    const e2 = decoder.decode(sse('text', '{"d":{"text":"llo"}}'))
    const skip = decoder.decode(sse('other', '{"d":{"text":"skip"}}'))
    const e3 = decoder.decode(sse('done', '{}'))

    expect(e1.events[0]).toMatchObject({ type: 'response.output_text.delta', delta: 'he' })
    expect(e2.events[0]).toMatchObject({ type: 'response.output_text.delta', delta: 'llo' })
    expect(skip.events).toEqual([])
    expect(decoder.terminalReceived()).toBe(true)
    expect(e3.done).toBe(false) // 帧型终止不置 done（排水继续）
    expect(e3.events.some((event) => event.type === 'response.completed')).toBe(true)
  })

  it('cumulative 模式做差分', () => {
    const config: CustomProtocolConfig = {
      id: 's2',
      request: { path: '/x' },
      response: {
        textPath: 'text',
        stream: { mode: 'cumulative', frames: [{ match: { path: 'text', op: 'nonEmpty' } }] },
      },
    }
    const decoder = new CustomProtocolStreamDecoder(config)
    const events = [
      ...decoder.decode(sse('', '{"text":"ab"}')).events,
      ...decoder.decode(sse('', '{"text":"abcd"}')).events,
    ]
    expect(events.map((event) => event.delta)).toEqual(['ab', 'cd'])
  })

  it('默认 [DONE] 终止', () => {
    const config: CustomProtocolConfig = {
      id: 's3',
      request: { path: '/x' },
      response: { textPath: 'text' },
    }
    const decoder = new CustomProtocolStreamDecoder(config)
    const result = decoder.decode(sse('', '[DONE]'))
    expect(result.done).toBe(true)
    expect(result.events[0].type).toBe('response.completed')
  })

  it('注册表：注册/查询/渲染', () => {
    registerCustomProtocol({
      id: 'Reg-Test',
      request: { path: '/r', body: { model: { field: 'model', mode: 'string' } } },
      response: { textPath: 'text' },
    })
    expect(getCustomProtocol('reg-test')?.id).toBe('Reg-Test')
  })

  it('协议类型归一化', () => {
    expect(normalizeCustomProtocolType(undefined)).toBe('llm')
    expect(normalizeCustomProtocolType('X-Custom ')).toBe('x-custom')
    expect(normalizeCustomProtocolType('bad')).toBe('')
  })

  it('MATCH_OP_EQUALS 常量存在性（导出面完整性）', () => {
    expect(MATCH_OP_EQUALS).toBe('equals')
  })
})
