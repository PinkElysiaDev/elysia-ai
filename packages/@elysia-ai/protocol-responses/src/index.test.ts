import { describe, expect, it } from 'vitest'
import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import { CONTENT_TEXT } from '@elysia-ai/maheshvara'
import {
  ResponsesStreamDecoder,
  decodeResponsesResponse,
  encodeResponsesRequest,
  extractMessageText,
} from './index.js'

function sse(data: string) {
  return { event: '', data, id: '', retryMs: undefined } as const
}

describe('encodeResponsesRequest', () => {
  it('消息 → input 数组（system 剔除进 instructions）', () => {
    const req: MaheshvaraRequest = {
      model: 'gpt-5',
      instructions: 'sys prompt',
      messages: [
        { role: 'system', content: [{ type: CONTENT_TEXT, text: 'more sys' }] },
        { role: 'user', content: [{ type: CONTENT_TEXT, text: 'hi' }] },
        { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', name: 'f', arguments: '{"a":1}' }] },
      ],
      max_output_tokens: 100,
    }
    const body = encodeResponsesRequest(req)
    expect(body['instructions']).toBe('sys prompt\n\nmore sys')
    expect(body['max_output_tokens']).toBe(100)
    const input = body['input'] as Array<Record<string, unknown>>
    expect(input[0]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'hi' }] })
    expect(input[1]).toEqual({ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{"a":1}' })
  })

  it('original 基底保留未建模字段', () => {
    const body = encodeResponsesRequest(
      { model: 'm2', messages: [{ role: 'user', content: [{ type: CONTENT_TEXT, text: 'x' }] }] },
      { model: 'm1', background: true, custom_field: 'keep' },
    )
    expect(body['model']).toBe('m2')
    expect(body['background']).toBe(true)
    expect(body['custom_field']).toBe('keep')
  })
})

describe('decodeResponsesResponse', () => {
  it('message/reasoning/function_call 输出项 + usage details', () => {
    const response = decodeResponsesResponse({
      id: 'resp_1', object: 'response', status: 'completed', model: 'gpt-5', created_at: 1755400000,
      output: [
        { id: 'rs_1', type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: '摘要' }], encrypted_content: 'enc' },
        { id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '答案', annotations: [] }] },
        { id: 'fc_1', type: 'function_call', status: 'completed', call_id: 'c1', name: 'f', arguments: '{"a":1}' },
      ],
      usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 5 } },
    })
    expect(response.status).toBe('completed')
    expect(extractMessageText(response)).toBe('答案')
    const reasoning = response.output?.find((i) => i.type === 'reasoning')
    expect(reasoning?.reasoning?.text).toBe('摘要')
    expect(reasoning?.reasoning?.encrypted_content).toBe('enc')
    expect(response.usage).toMatchObject({ input_tokens: 8, output_tokens: 6, total_tokens: 14, cached_input_tokens: 4, reasoning_tokens: 5 })
  })
})

describe('ResponsesStreamDecoder', () => {
  it('created → 文本增量 → 完成（带 usage 前置）的标准序列', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"type":"response.created","response":{"id":"resp_1","model":"gpt-5","status":"in_progress"}}')),
      ...decoder.decode(sse('{"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","status":"in_progress"}}')),
      ...decoder.decode(sse('{"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"你"}')),
      ...decoder.decode(sse('{"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"好"}')),
      ...decoder.decode(sse('{"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5","output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}')),
    ]
    expect(events[0].type).toBe('response.created')
    expect(events[0].response_id).toBe('resp_1')
    const deltas = events.filter((e) => e.type === 'response.output_text.delta')
    expect(deltas.map((e) => e.delta)).toEqual(['你', '好'])
    const usageEvent = events.find((e) => e.type === 'response.usage.delta')
    expect(usageEvent?.usage).toMatchObject({ input_tokens: 3, output_tokens: 2 })
    const completed = events.find((e) => e.type === 'response.completed')
    expect(completed?.response?.status).toBe('completed')
    expect(decoder.getTerminal()).toBe(true)
  })

  it('function_call_arguments 增量与完成', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = [
      ...decoder.decode(sse('{"type":"response.function_call_arguments.delta","output_index":0,"call_id":"c1","name":"f","delta":"{\\"a\\":"}')),
      ...decoder.decode(sse('{"type":"response.function_call_arguments.done","output_index":0,"call_id":"c1","name":"f","arguments":"{\\"a\\":1}"}')),
    ]
    expect(events[0].tool_arguments_delta).toBe('{"a":')
    expect(events[1].tool_arguments_done).toBe('{"a":1}')
    expect(events[1].tool_call_id).toBe('c1')
  })

  it('error 事件 → response.failed', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = decoder.decode(sse('{"type":"error","error":{"message":"boom","code":"500"}}'))
    expect(events[0].type).toBe('response.failed')
    expect(events[0].error?.message).toBe('boom')
    expect(decoder.getTerminal()).toBe(true)
  })
})

describe('elysia-api 深度更新同步（v0.2.0）', () => {
  it('reasoning.effort:"none" 整体省略（上游会静默当 low 档执行）', () => {
    const body = encodeResponsesRequest({ model: 'gpt-5', messages: [], reasoning: { effort: 'none' } })
    expect(body['reasoning']).toEqual({})
    const body2 = encodeResponsesRequest({ model: 'gpt-5', messages: [], reasoning: { effort: 'high' } })
    expect(body2['reasoning']).toEqual({ effort: 'high' })
  })

  it('携带加密推理时自动追加 include:["reasoning.encrypted_content"]，已含则不重复', () => {
    const body = encodeResponsesRequest({
      model: 'gpt-5',
      messages: [{ role: 'assistant', content: [{ type: 'reasoning', reasoning_text: 't', encrypted_content: 'enc' }] }],
    })
    expect(body['include']).toEqual(['reasoning.encrypted_content'])

    const body2 = encodeResponsesRequest({
      model: 'gpt-5',
      messages: [],
      input_items: [{ type: 'reasoning', reasoning: { encrypted_content: 'enc2' } }],
      include: ['reasoning.encrypted_content'],
    })
    expect(body2['include']).toEqual(['reasoning.encrypted_content'])

    const body3 = encodeResponsesRequest({ model: 'gpt-5', messages: [] })
    expect(body3['include']).toBeUndefined()
  })

  it('user 顶层写回', () => {
    const body = encodeResponsesRequest({ model: 'gpt-5', messages: [], user: 'u-9' })
    expect(body['user']).toBe('u-9')
  })

  it('server-tool 输出项整块 raw 捕获（载荷不缩水）', () => {
    const response = decodeResponsesResponse({
      id: 'resp_1', object: 'response', status: 'completed', created_at: 1, model: 'gpt-5',
      output: [
        { id: 'ws_1', type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'hi' }, results: [{ url: 'https://e' }] },
      ],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    })
    const item = response.output?.[0]
    expect(item?.type).toBe('web_search_call')
    expect(item?.raw).toEqual({
      id: 'ws_1', type: 'web_search_call', status: 'completed',
      action: { type: 'search', query: 'hi' }, results: [{ url: 'https://e' }],
    })
    expect(response.usage?.web_search_call_count).toBe(1)
  })

  it('response.reasoning_signature.delta 专线路由为签名事件（不再误入推理文本）', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = decoder.decode(sse(JSON.stringify({
      type: 'response.reasoning_signature.delta', item_id: 'rs_1', output_index: 0, delta: 'sig-part',
    })))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'response.reasoning_signature.delta',
      reasoning_signature_delta: 'sig-part',
      reasoning_signature_provider: 'openai',
    })
    expect(events[0].reasoning_delta).toBeUndefined()

    const decoder2 = new ResponsesStreamDecoder()
    const events2 = decoder2.decode(sse(JSON.stringify({
      type: 'response.reasoning_signature.delta', delta: 's2', provider: 'anthropic',
    })))
    expect(events2[0].reasoning_signature_provider).toBe('anthropic')
  })

  it('response.output_item.done 携带完整推理项（含密文）不丢弃', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = decoder.decode(sse(JSON.stringify({
      type: 'response.output_item.done', output_index: 0,
      item: { id: 'rs_1', type: 'reasoning', status: 'completed', summary: [], encrypted_content: 'enc-final' },
    })))
    const item = events.find((e) => e.type === 'response.output_item.done')?.output_item
    expect(item?.type).toBe('reasoning')
    expect(item?.reasoning?.encrypted_content).toBe('enc-final')
  })
})

describe('elysia-api v1.4.0 同步：错误分类', () => {
  it('response.failed 按 OpenAI type 反推分类', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = decoder.decode(sse('{"type":"response.failed","response":{"error":{"type":"rate_limit_error","message":"slow","code":"slow_down"}}}'))
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error?.class).toBe('rate_limit')
    expect(failed?.error?.code).toBe('slow_down')
  })

  it('error 事件 type 缺失时分类为空（对齐 Go 零值）', () => {
    const decoder = new ResponsesStreamDecoder()
    const events = decoder.decode(sse('{"type":"error","error":{"message":"bad"}}'))
    const failed = events.find((e) => e.type === 'response.failed')
    expect(failed?.error?.class).toBe('')
  })
})
