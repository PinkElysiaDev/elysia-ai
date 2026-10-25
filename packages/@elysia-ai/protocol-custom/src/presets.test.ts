/**
 * 四大 preset 的交叉验证：同一 fixture 分别驱动 preset 引擎与内置协议解码器，
 * 断言产出语义一致——「协议即数据」与「手写解码器」可互换的证明。
 * 转写自 Elysia-Api（Go）backend/server/presets/*.json（v1.4.0）。
 */

import { describe, expect, it } from 'vitest'
import type { MaheshvaraRequest, MaheshvaraStreamEvent } from '@elysia-ai/maheshvara'
import { AnthropicStreamDecoder } from '@elysia-ai/protocol-anthropic'
import { ChatCompletionsStreamDecoder } from '@elysia-ai/protocol-openai'
import { ResponsesStreamDecoder } from '@elysia-ai/protocol-responses'
import { GeminiStreamDecoder } from '@elysia-ai/protocol-gemini'
import { encodeChatCompletionsRequest } from '@elysia-ai/protocol-openai'
import {
  ANTHROPIC_MESSAGES_PRESET,
  GEMINI_GENERATE_PRESET,
  OPENAI_CHAT_PRESET,
  OPENAI_RESPONSES_PRESET,
} from './presets.js'
import { CustomProtocolStreamDecoder } from './stream.js'
import { renderCustomProtocolRequest } from './request.js'
import { validateCustomProtocol } from './validate.js'
import { customProtocolResponseToMaheshvara, registerCustomProtocol } from './registry.js'

function sse(data: string, event = '') {
  return { event, data, id: '', retryMs: undefined } as const
}

function textDeltas(events: MaheshvaraStreamEvent[]): string {
  return events
    .filter((event) => event.type === 'response.output_text.delta')
    .map((event) => event.delta ?? '')
    .join('')
}

function reasoningDeltas(events: MaheshvaraStreamEvent[]): string {
  return events
    .filter((event) => event.type === 'response.reasoning.delta')
    .map((event) => event.reasoning_delta ?? '')
    .join('')
}

function toolArgumentDeltas(events: MaheshvaraStreamEvent[]): string {
  return events
    .filter((event) => event.type === 'response.function_call_arguments.delta')
    .map((event) => event.tool_arguments_delta ?? '')
    .join('')
}

const SAMPLE_REQUEST: MaheshvaraRequest = {
  model: 'test-model',
  instructions: 'be nice',
  stream: true,
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
  ],
  tools: [{ type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object' } }],
}

describe('preset 校验', () => {
  it('四个 preset 均通过整体校验（含双模板渲染）', () => {
    for (const preset of [OPENAI_CHAT_PRESET, ANTHROPIC_MESSAGES_PRESET, GEMINI_GENERATE_PRESET, OPENAI_RESPONSES_PRESET]) {
      expect(() => validateCustomProtocol(preset)).not.toThrow()
    }
  })
})

describe('openai-chat preset ↔ 内置 Chat 解码器', () => {
  const frames = [
    sse('{"id":"c1","model":"m","choices":[{"index":0,"delta":{"role":"assistant"}}]}'),
    sse('{"choices":[{"index":0,"delta":{"content":"Hel"}}]}'),
    sse('{"choices":[{"index":0,"delta":{"content":"lo"}}]}'),
    sse('{"choices":[{"index":0,"delta":{"reasoning_content":"thinking..."}}]}'),
    sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\""}}]}}]}'),
    sse('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"SF\\"}"}}]}}]}'),
    sse('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":6,"total_tokens":16}}'),
  ]

  it('preset 引擎产出与内置解码器语义一致', () => {
    const builtin = new ChatCompletionsStreamDecoder()
    const builtinEvents = frames.flatMap((frame) => builtin.decode(frame))
    const engine = new CustomProtocolStreamDecoder(OPENAI_CHAT_PRESET)
    const engineEvents = frames.flatMap((frame) => engine.decode(frame).events)

    expect(textDeltas(engineEvents)).toBe(textDeltas(builtinEvents))
    expect(textDeltas(engineEvents)).toBe('Hello')
    expect(reasoningDeltas(engineEvents)).toBe('thinking...')
    expect(toolArgumentDeltas(engineEvents)).toBe('{"city":"SF"}')
    expect(toolArgumentDeltas(builtinEvents)).toBe('{"city":"SF"}')

    const engineTool = engineEvents.find((event) => event.type === 'response.function_call.added')
    const builtinTool = builtinEvents.find((event) => event.type === 'response.function_call.added')
    expect(engineTool?.tool_call_id).toBe(builtinTool?.tool_call_id)
    expect(engineTool?.tool_name).toBe('get_weather')

    const engineCompleted = engineEvents.find((event) => event.type === 'response.completed')
    expect(engineCompleted?.finish_reason).toBe('tool_calls')
    const engineUsage = engineEvents.filter((event) => event.type === 'response.usage.delta')
    expect(engineUsage.at(-1)?.usage).toMatchObject({ input_tokens: 10, output_tokens: 6, total_tokens: 16 })
    expect(engine.terminalReceived()).toBe(true)
  })

  it('preset 引擎跳过 usage-only 帧的正文映射', () => {
    const engine = new CustomProtocolStreamDecoder(OPENAI_CHAT_PRESET)
    const events = engine.decode(sse('{"choices":[],"usage":{"prompt_tokens":1,"total_tokens":1}}')).events
    // choices[0] isNull 帧：仅映射 usage，不产出正文事件
    expect(textDeltas(events)).toBe('')
    expect(events.some((event) => event.type === 'response.usage.delta')).toBe(true)
  })

  it('流式请求渲染对齐内置 encode（shape 复用）', () => {
    const rendered = renderCustomProtocolRequest(SAMPLE_REQUEST, OPENAI_CHAT_PRESET)
    const builtin = encodeChatCompletionsRequest(SAMPLE_REQUEST)
    expect(rendered.path).toBe('/v1/chat/completions')
    const body = JSON.parse(rendered.body!) as Record<string, unknown>
    expect(body['model']).toBe(builtin['model'])
    expect(body['messages']).toEqual(builtin['messages'])
    expect(body['tools']).toEqual(builtin['tools'])
    expect(body['stream']).toBe(true)
    expect((body['stream_options'] as Record<string, unknown>)['include_usage']).toBe(true)
    expect(body['max_tokens']).toBeUndefined() // omitIfEmpty
  })
})

describe('anthropic-messages preset ↔ 内置 Anthropic 解码器', () => {
  const frames = [
    sse('{"type":"message_start","message":{"id":"msg_1","model":"claude-x","role":"assistant","usage":{"input_tokens":25,"output_tokens":1}}}', 'message_start'),
    sse('{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}', 'content_block_start'),
    sse('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Good "}}', 'content_block_delta'),
    sse('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"morning"}}', 'content_block_delta'),
    sse('{"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":""}}', 'content_block_start'),
    sse('{"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"pondering..."}}', 'content_block_delta'),
    sse('{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}', 'content_block_start'),
    sse('{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}', 'content_block_delta'),
    sse('{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"SF\\"}"}}', 'content_block_delta'),
    sse('{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}', 'message_delta'),
  ]

  it('preset 引擎产出与内置解码器语义一致', () => {
    const builtin = new AnthropicStreamDecoder()
    const builtinEvents = frames.flatMap((frame) => builtin.decode(frame))
    const engine = new CustomProtocolStreamDecoder(ANTHROPIC_MESSAGES_PRESET)
    const engineEvents = frames.flatMap((frame) => engine.decode(frame).events)

    expect(textDeltas(engineEvents)).toBe('Good morning')
    expect(textDeltas(builtinEvents)).toBe('Good morning')
    expect(reasoningDeltas(engineEvents)).toBe('pondering...')
    expect(toolArgumentDeltas(engineEvents)).toBe('{"city":"SF"}')
    expect(toolArgumentDeltas(builtinEvents)).toBe('{"city":"SF"}')

    const engineTool = engineEvents.find((event) => event.type === 'response.function_call.added')
    expect(engineTool?.tool_call_id).toBe('toolu_1')
    expect(engineTool?.tool_name).toBe('get_weather')

    const engineCompleted = engineEvents.find((event) => event.type === 'response.completed')
    expect(engineCompleted?.finish_reason).toBe('tool_use')
    const usages = engineEvents.filter((event) => event.type === 'response.usage.delta')
    expect(usages[0]?.usage).toMatchObject({ input_tokens: 25, output_tokens: 1 })
    expect(usages.at(-1)?.usage).toMatchObject({ output_tokens: 42 })
    expect(engine.terminalReceived()).toBe(true)
  })

  it('error 帧映射为 upstream 分类失败', () => {
    const engine = new CustomProtocolStreamDecoder(ANTHROPIC_MESSAGES_PRESET)
    const events = engine.decode(sse('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}', 'error')).events
    const failed = events.find((event) => event.type === 'response.failed')
    // errorPath 命中的是错误对象：message 为对象 JSON 文本（Go customValueString），
    // 原对象保留在 raw。
    expect(failed?.error?.message).toBe('{"type":"overloaded_error","message":"busy"}')
    expect(failed?.error?.class).toBe('upstream')
    expect(failed?.error?.raw).toEqual({ type: 'overloaded_error', message: 'busy' })
    expect(engine.terminalReceived()).toBe(true)
  })

  it('非流式响应映射（textFilter/thinking 过滤 + toolCall input 别名）', () => {
    registerCustomProtocol(ANTHROPIC_MESSAGES_PRESET)
    const response = customProtocolResponseToMaheshvara({
      id: 'msg_9',
      content: [
        { type: 'thinking', thinking: 'deep' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', id: 't9', name: 'lookup', input: { q: 'x' } },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 7 },
    }, 'anthropic-messages')
    const text = response.output?.find((item) => item.type === 'message')
    expect(text?.content?.[0]?.text).toBe('answer')
    const reasoning = response.output?.find((item) => item.type === 'reasoning')
    expect(reasoning?.content?.[0]?.reasoning_text).toBe('deep')
    const call = response.output?.find((item) => item.type === 'function_call')
    expect(call?.call_id).toBe('t9')
    expect(call?.arguments).toBe('{"q":"x"}')
    expect(response.usage).toMatchObject({ input_tokens: 5, output_tokens: 7, total_tokens: 12 })
  })
})

describe('gemini-generate preset ↔ 内置 Gemini 解码器', () => {
  const frames = [
    sse('{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}'),
    sse('{"candidates":[{"content":{"parts":[{"text":"...","thought":true}]}}]}'),
    sse('{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"SF"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":4,"totalTokenCount":9}}'),
  ]

  it('preset 引擎产出与内置解码器语义一致', () => {
    const builtin = new GeminiStreamDecoder()
    const builtinEvents = frames.flatMap((frame) => builtin.decode(frame))
    const engine = new CustomProtocolStreamDecoder(GEMINI_GENERATE_PRESET)
    const engineEvents = frames.flatMap((frame) => engine.decode(frame).events)

    expect(textDeltas(engineEvents)).toBe('Hi')
    expect(textDeltas(builtinEvents)).toBe('Hi')
    expect(reasoningDeltas(engineEvents)).toBe('...')
    const engineTool = engineEvents.find((event) => event.type === 'response.function_call.added')
    expect(engineTool?.tool_name).toBe('get_weather')
    // Gemini 的 functionCall 参数为完整对象：一次性 arguments.done（经别名 functionCall.args）
    const engineCompleted = engineEvents.find((event) => event.type === 'response.completed')
    expect(engineCompleted?.finish_reason).toBe('STOP')
    const lastUsage = engineEvents.filter((event) => event.type === 'response.usage.delta').at(-1)?.usage
    expect(lastUsage).toMatchObject({ input_tokens: 5, output_tokens: 4, total_tokens: 9 })
    expect(engine.terminalReceived()).toBe(true)
  })

  it('路径模板渲染 model 且流式切换 pathStream', () => {
    const rendered = renderCustomProtocolRequest(SAMPLE_REQUEST, GEMINI_GENERATE_PRESET)
    expect(rendered.path).toBe('/v1beta/models/test-model:streamGenerateContent?alt=sse')
    const nonStream = renderCustomProtocolRequest({ ...SAMPLE_REQUEST, stream: false }, GEMINI_GENERATE_PRESET)
    expect(nonStream.path).toBe('/v1beta/models/test-model:generateContent')
    const body = JSON.parse(nonStream.body!) as Record<string, unknown>
    expect(Array.isArray(body['contents'])).toBe(true)
    expect((body['systemInstruction'] as Record<string, unknown>)['parts']).toEqual([{ text: 'be nice' }])
  })
})

describe('openai-responses preset ↔ 内置 Responses 解码器', () => {
  const frames = [
    sse('{"type":"response.created","response":{"id":"resp_1"}}'),
    sse('{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_9","name":"get_weather"}}'),
    sse('{"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"city\\""}'),
    sse('{"type":"response.function_call_arguments.delta","output_index":0,"delta":":\\"Tokyo\\"}"}'),
    sse('{"type":"response.output_text.delta","delta":"Sure"}'),
    sse('{"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}'),
  ]

  it('preset 引擎产出与内置解码器语义一致', () => {
    const builtin = new ResponsesStreamDecoder()
    const builtinEvents = frames.flatMap((frame) => builtin.decode(frame))
    const engine = new CustomProtocolStreamDecoder(OPENAI_RESPONSES_PRESET)
    const engineEvents = frames.flatMap((frame) => engine.decode(frame).events)

    expect(textDeltas(engineEvents)).toBe('Sure')
    expect(textDeltas(builtinEvents)).toBe('Sure')
    expect(toolArgumentDeltas(engineEvents)).toBe('{"city":"Tokyo"}')
    expect(toolArgumentDeltas(builtinEvents)).toBe('{"city":"Tokyo"}')
    const engineTool = engineEvents.find((event) => event.type === 'response.function_call.added')
    expect(engineTool?.tool_call_id).toBe('call_9')
    expect(engineTool?.tool_name).toBe('get_weather')
    const lastUsage = engineEvents.filter((event) => event.type === 'response.usage.delta').at(-1)?.usage
    expect(lastUsage).toMatchObject({ input_tokens: 8, output_tokens: 3, total_tokens: 11 })
    expect(engine.terminalReceived()).toBe(true)
    // completed 帧的映射只带 usagePath：终态来自帧型 terminal 而非 finish 映射
    // （Go 同语义），sawFinishReason 保持 false。
    expect(engine.sawFinishReason()).toBe(false)
  })

  it('response.failed 帧经 payloadPath 解包映射错误', () => {
    const engine = new CustomProtocolStreamDecoder(OPENAI_RESPONSES_PRESET)
    const events = engine.decode(sse('{"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}')).events
    const failed = events.find((event) => event.type === 'response.failed')
    expect(failed?.error?.message).toBe('{"code":"server_error","message":"boom"}')
    expect(engine.terminalReceived()).toBe(true)
  })
})
