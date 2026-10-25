import { describe, expect, it } from 'vitest'
import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import { CONTENT_TEXT, CONTENT_TOOL_OUTPUT } from '@elysia-ai/maheshvara'
import {
  GeminiStreamDecoder,
  decodeGenerateContentResponse,
  encodeGenerateContentRequest,
  extractMessageText,
} from './index.js'

function sse(data: string) {
  return { event: '', data, id: '', retryMs: undefined } as const
}

describe('encodeGenerateContentRequest', () => {
  it('system 消息进 systemInstruction；assistant → model；连续同角色合并', () => {
    const req: MaheshvaraRequest = {
      model: 'gemini-x',
      messages: [
        { role: 'system', content: [{ type: CONTENT_TEXT, text: 'sys' }] },
        { role: 'user', content: [{ type: CONTENT_TEXT, text: 'a' }] },
        { role: 'user', content: [{ type: CONTENT_TEXT, text: 'b' }] },
      ],
      max_output_tokens: 256,
      temperature: 0.4,
    }
    const body = encodeGenerateContentRequest(req)
    expect(body['systemInstruction']).toEqual({ parts: [{ text: 'sys' }] })
    expect(body['generationConfig']).toEqual({ temperature: 0.4, maxOutputTokens: 256 })
    const contents = body['contents'] as Array<Record<string, unknown>>
    // 两条连续 user 合并为一条。
    expect(contents).toHaveLength(1)
    expect(contents[0]['role']).toBe('user')
    expect(contents[0]['parts']).toEqual([{ text: 'a' }, { text: 'b' }])
  })

  it('tool_calls → functionCall part；functionResponse 按函数名回查', () => {
    const body = encodeGenerateContentRequest({
      model: 'm',
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', name: 'f', arguments: '{"a":1}' }] },
        { role: 'user', content: [{ type: CONTENT_TOOL_OUTPUT, tool_call_id: 'c1', tool_output: '{"ok":true}' }] },
      ],
    })
    const contents = body['contents'] as Array<Record<string, unknown>>
    // 跨厂商 functionCall 无签名时注入占位签名跳过上游校验（Go 行为）。
    expect(contents[0]['parts']).toEqual([{ functionCall: { name: 'f', args: { a: 1 }, id: 'c1' }, thoughtSignature: 'skip_thought_signature_validator' }])
    expect(contents[1]['parts']).toEqual([{ functionResponse: { name: 'f', response: { ok: true }, id: 'c1' } }])
  })

  it('functionResponse 找不到对应函数名时抛错', () => {
    expect(() => encodeGenerateContentRequest({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: CONTENT_TOOL_OUTPUT, tool_call_id: 'nope', tool_output: 'x' }] }],
    })).toThrow(/no matching function name/)
  })
})

describe('decodeGenerateContentResponse', () => {
  it('thought 部件与普通文本分流；functionCall 成为独立输出项', () => {
    const response = decodeGenerateContentResponse({
      responseId: 'g1', modelVersion: 'gemini-x',
      candidates: [{ content: { parts: [
        { text: '思考', thought: true, thoughtSignature: 'sig' },
        { text: '回答' },
        { functionCall: { id: 'c1', name: 'f', args: { a: 1 } } },
      ] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10, thoughtsTokenCount: 2 },
    })
    expect(response.stop_reason).toBe('STOP')
    expect(extractMessageText(response)).toBe('回答')
    const reasoning = response.output?.find((i) => i.type === 'reasoning')
    expect(reasoning?.content?.[0]?.text).toBe('思考')
    const call = response.output?.find((i) => i.type === 'function_call')
    expect(call?.name).toBe('f')
    expect(response.usage).toMatchObject({
      input_tokens: 7, output_tokens: 5, total_tokens: 10,
      reasoning_tokens: 2, cached_input_tokens: undefined,
    })
  })
})

describe('GeminiStreamDecoder', () => {
  it('文本/thought/函数调用/完成的流式序列', () => {
    const decoder = new GeminiStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"candidates":[{"content":{"parts":[{"text":"你"}]},"index":0}]}')),
      ...decoder.decode(sse('{"candidates":[{"content":{"parts":[{"text":"想","thought":true}]},"index":0}]}')),
      ...decoder.decode(sse('{"candidates":[{"content":{"parts":[{"functionCall":{"id":"c1","name":"f","args":{"a":1}}}]},"index":0}]}')),
      ...decoder.decode(sse('{"candidates":[{"content":{"parts":[]},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}}')),
    ]
    expect(events.find((e) => e.type === 'response.output_text.delta')?.delta).toBe('你')
    expect(events.find((e) => e.type === 'response.reasoning.delta')?.reasoning_delta).toBe('想')
    expect(events.find((e) => e.type === 'response.function_call.added')?.tool_name).toBe('f')
    expect(events.find((e) => e.type === 'response.function_call_arguments.done')?.tool_arguments_done).toBe('{"a":1}')
    expect(events.find((e) => e.type === 'response.completed')?.finish_reason).toBe('STOP')
    expect(decoder.getTerminal()).toBe(true)
  })

  it('promptFeedback 拦截 → response.failed', () => {
    const decoder = new GeminiStreamDecoder()
    const events = decoder.decode(sse('{"promptFeedback":{"blockReason":"SAFETY"}}'))
    expect(events[0].type).toBe('response.failed')
    expect(events[0].error?.type).toBe('content_filter')
  })
})

describe('elysia-api 深度更新同步（v0.2.0）', () => {
  it('groundingMetadata → 首个文本 part 的 annotations（gemini_grounding_metadata 包装）', () => {
    const response = decodeGenerateContentResponse({
      candidates: [{
        content: { parts: [{ text: '答案' }, { text: '补充' }] },
        finishReason: 'STOP',
        groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://e' } }] },
      }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
    })
    const message = response.output?.find((item) => item.type === 'message')
    expect(message?.content?.[0]?.annotations).toEqual([
      { gemini_grounding_metadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://e' } }] } },
    ])
    // 只挂首个文本 part
    expect(message?.content?.[1]?.annotations).toBeUndefined()
  })

  it('流式 grounding 挂到同 chunk 首个非 thought 文本事件', () => {
    const decoder = new GeminiStreamDecoder()
    const events = decoder.decode(sse(JSON.stringify({
      candidates: [{
        index: 0,
        content: { parts: [{ text: '想一想', thought: true }, { text: '答案' }] },
        groundingMetadata: { webSearchQueries: ['q'] },
      }],
    })))
    const textEvents = events.filter((e) => e.type === 'response.output_text.delta')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0].annotations).toEqual([{ gemini_grounding_metadata: { webSearchQueries: ['q'] } }])
    const thoughtEvents = events.filter((e) => e.type === 'response.reasoning.delta')
    expect(thoughtEvents[0].annotations).toBeUndefined()
  })

  it('无 id 的 functionCall 合成 id 用解码器级单调计数器（跨 chunk 不撞）', () => {
    const decoder = new GeminiStreamDecoder()
    const events = [
      ...decoder.decode(sse(JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ text: 'a' }, { functionCall: { name: 'f1', args: {} } }] } }],
      }))),
      ...decoder.decode(sse(JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ text: 'b' }, { functionCall: { name: 'f2', args: {} } }] } }],
      }))),
    ]
    const ids = events.filter((e) => e.type === 'response.function_call.added').map((e) => e.tool_call_id)
    expect(ids).toEqual(['call_syn_0', 'call_syn_1'])
    expect(new Set(ids).size).toBe(2)
  })

  it('n > 1 显式拒绝（单候选契约）', () => {
    expect(() => encodeGenerateContentRequest({ model: 'gemini-x', messages: [], n: 3 })).toThrow(/single candidate/)
  })

  it('usage 模态拆分与工具/thought token 计入', () => {
    const response = decodeGenerateContentResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 90, toolUsePromptTokenCount: 10,
        candidatesTokenCount: 60, thoughtsTokenCount: 20, totalTokenCount: 180,
        promptTokensDetails: [{ modality: 'TEXT', tokenCount: 80 }, { modality: 'IMAGE', tokenCount: 10 }],
        candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }],
      },
    })
    expect(response.usage).toMatchObject({
      input_tokens: 100, output_tokens: 80, total_tokens: 180,
      reasoning_tokens: 20, tool_use_tokens: 10,
      text_input_tokens: 80, image_input_tokens: 10, text_output_tokens: 40,
    })
  })
})

describe('elysia-api v1.4.0 同步：错误分类', () => {
  it('promptFeedback 阻断的失败事件携带 invalid_request 分类', () => {
    const decoder = new GeminiStreamDecoder()
    const events = decoder.decode(sse('{"promptFeedback":{"blockReason":"SAFETY"}}'))
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error?.class).toBe('invalid_request')
    expect(failed?.error?.type).toBe('content_filter')
  })
})
