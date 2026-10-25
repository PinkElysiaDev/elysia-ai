import { describe, expect, it } from 'vitest'
import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import { CONTENT_IMAGE, CONTENT_TEXT, CONTENT_TOOL_OUTPUT } from '@elysia-ai/maheshvara'
import {
  ChatCompletionsStreamDecoder,
  decodeChatCompletionsResponse,
  encodeChatCompletionsRequest,
  extractMessageText,
} from './index.js'

function sse(data: string) {
  return { event: '', data, id: '', retryMs: undefined } as const
}

describe('encodeChatCompletionsRequest', () => {
  it('基础消息：system 保留、单文本部件折叠回字符串', () => {
    const req: MaheshvaraRequest = {
      model: 'gpt-4o',
      instructions: 'be nice',
      messages: [
        { role: 'system', content: [{ type: CONTENT_TEXT, text: 'extra sys' }] },
        { role: 'user', content: [{ type: CONTENT_TEXT, text: 'hi' }] },
      ],
      max_output_tokens: 128,
      temperature: 0.5,
    }
    const body = encodeChatCompletionsRequest(req)
    expect(body['model']).toBe('gpt-4o')
    expect(body['max_tokens']).toBe(128)
    expect(body['temperature']).toBe(0.5)
    const messages = body['messages'] as Array<Record<string, unknown>>
    // instructions 变成首条 system；原 system 消息原样保留（Go 行为）。
    expect(messages[0]).toEqual({ role: 'system', content: 'be nice' })
    expect(messages[1]).toEqual({ role: 'system', content: 'extra sys' })
    expect(messages[2]).toEqual({ role: 'user', content: 'hi' })
  })

  it('stream=true 时注入 stream_options.include_usage', () => {
    const body = encodeChatCompletionsRequest({ model: 'm', messages: [], stream: true })
    expect(body['stream']).toBe(true)
    expect(body['stream_options']).toEqual({ include_usage: true })
  })

  it('图片部件 → image_url data URI', () => {
    const body = encodeChatCompletionsRequest({
      model: 'm',
      messages: [{ role: 'user', content: [
        { type: CONTENT_TEXT, text: '看图' },
        { type: CONTENT_IMAGE, image_base64: 'QUJD', media_type: 'image/png' },
      ] }],
    })
    const messages = body['messages'] as Array<Record<string, unknown>>
    expect(messages[0]['content']).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ])
  })

  it('tool_calls 缺 id 时合成确定性 ID；tool_output 变 role:"tool" 消息', () => {
    const body = encodeChatCompletionsRequest({
      model: 'm',
      messages: [
        { role: 'assistant', tool_calls: [{ id: '', type: 'function', name: 'get_time', arguments: '{}' }] },
        { role: 'user', content: [{ type: CONTENT_TOOL_OUTPUT, tool_call_id: 'call_0_0', tool_output: '12:00' }] },
      ],
    })
    const messages = body['messages'] as Array<Record<string, unknown>>
    const assistant = messages.find((m) => m['role'] === 'assistant')!
    expect((assistant['tool_calls'] as any[])[0]['id']).toBe('call_0_0')
    const tool = messages.find((m) => m['role'] === 'tool')!
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'call_0_0', content: '12:00' })
  })

  it('n > 1 显式拒绝；prompt_cache_retention 透传', () => {
    expect(() => encodeChatCompletionsRequest({ model: 'm', messages: [], n: 2 })).toThrow(/n=1 only/)
    const body = encodeChatCompletionsRequest({
      model: 'm', messages: [], prompt_cache_key: 'k', prompt_cache_retention: { seconds: 3600 },
    })
    expect(body['prompt_cache_retention']).toEqual({ seconds: 3600 })
  })

  it('带 annotations 的单文本部件不折叠为字符串，标注随文本下发', () => {
    const body = encodeChatCompletionsRequest({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: CONTENT_TEXT, text: '引用文', annotations: [{ type: 'url_citation' }] }] }],
    })
    const messages = body['messages'] as Array<Record<string, unknown>>
    expect(messages[0]['content']).toEqual([
      { type: 'text', text: '引用文', annotations: [{ type: 'url_citation' }] },
    ])
  })

  it('未知 part 裸透传仅限 OpenAI 已知 part 类型', () => {
    const body = encodeChatCompletionsRequest({
      model: 'm',
      messages: [{ role: 'user', content: [
        { type: 'unknown_claude_block', raw: { type: 'server_tool_use', id: 'x' } },
        { type: 'unknown_openai_part', raw: { type: 'file', file_id: 'f1' } },
      ] }],
    })
    const messages = body['messages'] as Array<Record<string, unknown>>
    expect(messages[0]['content']).toEqual([{ type: 'file', file_id: 'f1' }])
  })

  it('推理 parts 重建 reasoning_details：明文逐条 + openai 密文，其他厂商密文丢弃', () => {
    const body = encodeChatCompletionsRequest({
      model: 'm',
      messages: [{ role: 'assistant', content: [
        { type: 'reasoning', reasoning_text: '想过了', raw: { type: 'reasoning.text', text: '旧的', foo: 1 } },
        { type: 'reasoning', encrypted_content: 'enc-oai', encrypted_provider: 'openai' },
        { type: 'reasoning', encrypted_content: 'enc-claude', encrypted_provider: 'anthropic' },
      ] }],
    })
    const messages = body['messages'] as Array<Record<string, unknown>>
    expect(messages[0]['reasoning_details']).toEqual([
      { type: 'reasoning.text', text: '想过了', foo: 1 },
      { type: 'reasoning.encrypted', data: 'enc-oai' },
    ])
  })
})

describe('decodeChatCompletionsResponse', () => {
  it('典型响应 → maheshvara（消息项 + usage + finish）', () => {
    const response = decodeChatCompletionsResponse({
      id: 'chatcmpl-1', object: 'chat.completion', created: 1755400000, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
    expect(response.id).toBe('chatcmpl-1')
    expect(response.stop_reason).toBe('stop')
    expect(response.usage).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
    expect(extractMessageText(response)).toBe('你好')
  })

  it('reasoning_content 与 tool_calls 分别成为独立输出项', () => {
    const response = decodeChatCompletionsResponse({
      id: 'x', model: 'm',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: {
        role: 'assistant', content: null, reasoning_content: '思考中',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
      } }],
    })
    const types = response.output?.map((item) => item.type)
    expect(types).toContain('reasoning')
    expect(types).toContain('function_call')
    const call = response.output?.find((item) => item.type === 'function_call')
    expect(call?.name).toBe('f')
    expect(call?.arguments).toBe('{"a":1}')
  })

  it('system_fingerprint 解析；usage 未知键透传 + 模态拆分', () => {
    const response = decodeChatCompletionsResponse({
      id: 'x', model: 'm', system_fingerprint: 'fp-abc',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: {
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20, text_tokens: 90, audio_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 30, text_tokens: 20 },
        future_counter: 7,
      },
    })
    expect(response.system_fingerprint).toBe('fp-abc')
    expect(response.usage).toMatchObject({
      cached_input_tokens: 20,
      text_input_tokens: 90,
      audio_input_tokens: 10,
      reasoning_tokens: 30,
      text_output_tokens: 20,
    })
    expect(response.usage?.raw).toMatchObject({ future_counter: 7 })
  })

  it('reasoning_details（OpenRouter 风格）逐条成为推理项，密文记签发方', () => {
    const response = decodeChatCompletionsResponse({
      id: 'x', model: 'm',
      choices: [{ index: 0, finish_reason: 'stop', message: {
        role: 'assistant', content: '答',
        reasoning_details: [
          { type: 'reasoning.text', text: '先想想' },
          { type: 'reasoning.encrypted', data: 'enc-1' },
        ],
      } }],
    })
    const reasoningItems = response.output?.filter((item) => item.type === 'reasoning') ?? []
    expect(reasoningItems).toHaveLength(2)
    expect(reasoningItems[0].content?.[0]).toMatchObject({ reasoning_text: '先想想' })
    expect(reasoningItems[1].content?.[0]).toMatchObject({ encrypted_content: 'enc-1', encrypted_provider: 'openai' })
  })
})

describe('ChatCompletionsStreamDecoder', () => {
  it('文本增量 → 完成 → [DONE] 的标准序列', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant"}}]}')),
      ...decoder.decode(sse('{"id":"c1","choices":[{"index":0,"delta":{"content":"你"}}]}')),
      ...decoder.decode(sse('{"id":"c1","choices":[{"index":0,"delta":{"content":"好"}}]}')),
      ...decoder.decode(sse('{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}')),
      ...decoder.decode(sse('[DONE]')),
    ]
    expect(events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta)).toEqual(['你', '好'])
    const completed = events.find((e) => e.type === 'response.completed')
    expect(completed?.finish_reason).toBe('stop')
    expect(decoder.getTerminal()).toBe(true)
    expect(events.find((e) => e.type === 'response.usage.delta')?.usage).toMatchObject({ input_tokens: 3, output_tokens: 2 })
  })

  it('工具调用增量跨事件拼装并在 finish 时补 arguments_done', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"f","arguments":""}}]}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":"}}]}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}')),
    ]
    expect(events.find((e) => e.type === 'response.function_call.added')?.tool_name).toBe('f')
    const deltas = events.filter((e) => e.type === 'response.function_call_arguments.delta')
    expect(deltas.map((e) => e.tool_arguments_delta).join('')).toBe('{"a":1}')
    const done = events.find((e) => e.type === 'response.function_call_arguments.done')
    expect(done?.tool_arguments_done).toBe('{"a":1}')
    expect(done?.tool_call_id).toBe('call_9')
  })

  it('reasoning_content 增量映射为 reasoning delta', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = decoder.decode(sse('{"choices":[{"index":0,"delta":{"reasoning_content":"想一想"}}]}'))
    expect(events[0].type).toBe('response.reasoning.delta')
    expect(events[0].reasoning_delta).toBe('想一想')
  })

  it('[DONE] 前有 choice 却无 finish_reason → response.failed（严格终止语义）', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"content":"写到一半"}}]}')),
      ...decoder.decode(sse('[DONE]')),
    ]
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error).toMatchObject({ type: 'upstream_stream_error' })
    expect(events.find((e) => e.type === 'response.completed' && e.finish_reason === undefined)).toBeUndefined()
  })

  it('finish_reason:"error" → 终态失败并提取错误信息', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{},"finish_reason":"error"}],"error":{"message":"上游炸了"}}')),
    ]
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error).toMatchObject({ type: 'upstream_stream_error', message: '上游炸了' })
    expect(decoder.getSawFinishReason()).toBe(true)
    expect(events.find((e) => e.type === 'response.completed')).toBeUndefined()
  })

  it('终块快照：已流式输出只补缺失后缀，已流过的 reasoning 不重发', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"role":"assistant"}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"reasoning_content":"想"}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"content":"你好"}}]}')),
      // 终块携带完整 message（快照）：文本=你好世界、推理重复出现
      ...decoder.decode(sse('{"choices":[{"index":0,"message":{"role":"assistant","reasoning_content":"想","content":"你好世界"},"finish_reason":"stop"}]}')),
    ]
    const deltas = events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta)
    expect(deltas).toEqual(['你好', '世界'])
    const reasoning = events.filter((e) => e.type === 'response.reasoning.delta').map((e) => e.reasoning_delta)
    expect(reasoning).toEqual(['想'])
  })

  it('终块快照的工具参数：与累计一致不重发，发散则以完整值走 done', () => {
    const consistent = new ChatCompletionsStreamDecoder()
    const events1 = [
      ...consistent.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}')),
      ...consistent.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}')),
      ...consistent.decode(sse('{"choices":[{"index":0,"message":{"tool_calls":[{"id":"c1","function":{"name":"f","arguments":"{\\"a\\":1}"}}]},"finish_reason":"tool_calls"}]}')),
    ]
    expect(events1.filter((e) => e.type === 'response.function_call_arguments.delta').map((e) => e.tool_arguments_delta).join('')).toBe('{"a":1}')
    // 快照与累计一致：不产生任何额外 delta/done（参数在 finish 时统一补 done）
    expect(events1.find((e) => e.type === 'response.function_call_arguments.delta' && e.tool_arguments_delta === '{"a":1}')).toBeUndefined()

    const diverged = new ChatCompletionsStreamDecoder()
    const events2 = [
      ...diverged.decode(sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c2","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}')),
      ...diverged.decode(sse('{"choices":[{"index":0,"message":{"tool_calls":[{"id":"c2","function":{"name":"f","arguments":"{\\"b\\":2}"}}]},"finish_reason":"tool_calls"}]}')),
    ]
    const done = events2.find((e) => e.type === 'response.function_call_arguments.done')
    expect(done?.tool_arguments_done).toBe('{"b":2}')
  })

  it('合法空补全（content_filter 且无内容）不因缺输出而失败', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{"role":"assistant"}}]}')),
      ...decoder.decode(sse('{"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}')),
      ...decoder.decode(sse('[DONE]')),
    ]
    expect(decoder.getTerminal()).toBe(true)
    expect(events.find((e) => e.type === 'response.failed')).toBeUndefined()
    expect(events.find((e) => e.type === 'response.completed')?.finish_reason).toBe('content_filter')
  })
})

describe('elysia-api v1.4.0 同步：错误分类与遗留 function calling', () => {
  it('RawExtra.max_tokens_field 指定时回写 max_completion_tokens 字段名', () => {
    const base: MaheshvaraRequest = {
      model: 'o-preview',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_output_tokens: 512,
    }
    const modern = encodeChatCompletionsRequest({ ...base })
    expect(modern['max_tokens']).toBe(512)
    expect(modern['max_completion_tokens']).toBeUndefined()

    const oseries = encodeChatCompletionsRequest({ ...base, RawExtra: { max_tokens_field: 'max_completion_tokens' } })
    expect(oseries['max_completion_tokens']).toBe(512)
    expect(oseries['max_tokens']).toBeUndefined()
  })

  it('legacy_function 标记的工具分流到 functions 数组，现代工具仍走 tools', () => {
    const body = encodeChatCompletionsRequest({
      model: 'gpt',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [
        { type: 'function', name: 'modern_tool', description: 'd', parameters: { type: 'object' } },
        {
          type: 'function',
          name: 'old_tool',
          description: 'legacy',
          parameters: { type: 'object', properties: {} },
          raw: { legacy_function: true },
        },
      ],
    })
    const tools = body['tools'] as Array<Record<string, unknown>>
    const functions = body['functions'] as Array<Record<string, unknown>>
    expect(tools).toHaveLength(1)
    expect((tools[0]['function'] as Record<string, unknown>)['name']).toBe('modern_tool')
    expect(functions).toHaveLength(1)
    expect(functions[0]['name']).toBe('old_tool')
    expect(functions[0]['parameters']).toEqual({ type: 'object', properties: {} })
  })

  it('legacy_function 标记的调用还原为消息级 function_call 单对象', () => {
    const body = encodeChatCompletionsRequest({
      model: 'gpt',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          tool_calls: [{
            type: 'function',
            name: 'old_tool',
            arguments: '{"a":1}',
            raw: { legacy_function: true },
          }],
        },
      ],
    })
    const assistant = (body['messages'] as Array<Record<string, unknown>>)[1]
    expect(assistant['function_call']).toEqual({ name: 'old_tool', arguments: '{"a":1}' })
    expect(assistant['tool_calls']).toBeUndefined()
  })

  it('finish_reason=error 的失败事件携带 upstream 分类', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    const events = decoder.decode(sse('{"choices":[{"index":0,"delta":{},"finish_reason":"error"}]}'))
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error?.type).toBe('upstream_stream_error')
    expect(failed?.error?.class).toBe('upstream')
  })

  it('[DONE] 缺 finish 的失败事件不带分类（对齐 Go 零值）', () => {
    const decoder = new ChatCompletionsStreamDecoder()
    decoder.decode(sse('{"choices":[{"index":0,"delta":{"role":"assistant"}}]}'))
    const events = decoder.decode(sse('[DONE]'))
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error?.type).toBe('upstream_stream_error')
    expect(failed?.error?.class).toBeUndefined()
  })
})
