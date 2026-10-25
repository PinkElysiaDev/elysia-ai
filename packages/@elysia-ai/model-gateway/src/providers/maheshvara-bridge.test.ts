import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DialogueMessage } from '@elysia-ai/core'
import { createAnthropicProvider } from './anthropic.js'
import { createChatCompletionsProvider } from './chat-completions.js'
import { createGeminiProvider } from './gemini.js'
import { createResponsesProvider } from './responses.js'

const messages: DialogueMessage[] = [
  { role: 'system', content: '你是助手' },
  { role: 'user', content: '你好' },
]

/** 工具循环中典型的消息序列：用户 → assistant 请求工具 → 工具结果回填。 */
const toolMessages: DialogueMessage[] = [
  { role: 'user', content: '看下天气' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_1', type: 'function', name: 'get_weather', arguments: '{"city":"上海"}' }],
  },
  { role: 'tool', toolCallId: 'call_1', name: 'get_weather', content: '{"temp":26}' },
]

const weatherTool = {
  name: 'get_weather',
  description: '查询城市天气',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}

function mockFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(payload),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('网关 provider 基于协议包的端到端链路', () => {
  it('chat-completions：encode → fetch → decode 全链路', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-1', object: 'chat.completion', created: 1755400000, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '回复' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    })
    const provider = createChatCompletionsProvider({
      id: 'p1', type: 'chat-completions', apiKey: 'sk-x', baseURL: 'https://api.example.com', model: 'gpt-4o',
      maxTokens: 256, temperature: 0.2,
    })
    const response = await provider.execute({ messages })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    const sentBody = JSON.parse(init.body as string)
    // maheshvara 桥接：system 保留、user 单文本折叠回字符串。
    expect(sentBody.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
    ])
    expect(sentBody.max_tokens).toBe(256)
    expect(sentBody.temperature).toBe(0.2)
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-x')

    expect(response.output).toBe('回复')
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 })
    expect(response.messages).toHaveLength(3)
    expect(response.messages?.[2]).toEqual({ role: 'assistant', content: '回复' })
  })

  it('anthropic：system 抽取与 text block 解析', async () => {
    const fetchMock = mockFetch({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '答' }],
      usage: { input_tokens: 3, output_tokens: 1 },
    })
    const provider = createAnthropicProvider({
      id: 'p2', type: 'anthropic', apiKey: 'k', baseURL: 'https://api.example.com', model: 'claude-x',
    })
    const response = await provider.execute({ messages })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/messages')
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.system).toBe('你是助手')
    expect(sentBody.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '你好' }] }])
    expect(sentBody.max_tokens).toBe(4096)
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k')

    expect(response.output).toBe('答')
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4 })
  })

  it('gemini：systemInstruction 与 finishReason 归一化', async () => {
    const fetchMock = mockFetch({
      responseId: 'g1', modelVersion: 'gemini-x',
      candidates: [{ content: { parts: [{ text: '答' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    })
    const provider = createGeminiProvider({
      id: 'p3', type: 'gemini', apiKey: 'gk', baseURL: 'https://api.example.com', model: 'gemini-x',
    })
    const response = await provider.execute({ messages })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // P2-11：密钥改 x-goog-api-key 头，不再进 URL
    expect(url).toBe('https://api.example.com/v1beta/models/gemini-x:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gk')
    expect(response.output).toBe('答')
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({ inputTokens: 2, outputTokens: 1, totalTokens: 3 })
  })

  it('responses：input 数组与 output_text 提取', async () => {
    const fetchMock = mockFetch({
      id: 'resp_1', object: 'response', status: 'completed', model: 'gpt-5', created_at: 1755400000,
      output: [{ id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '答' }] }],
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    })
    const provider = createResponsesProvider({
      id: 'p4', type: 'responses', apiKey: 'sk', baseURL: 'https://api.example.com', model: 'gpt-5',
    })
    const response = await provider.execute({ messages })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/responses')
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.instructions).toBe('你是助手')
    expect(sentBody.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }])
    expect(response.output).toBe('答')
    // P1-11：completed 状态归一化为统一词表 'stop'，而非裸生命周期状态
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 2, totalTokens: 7 })
  })
})

describe('工具调用通道（Phase 0）', () => {
  it('chat-completions：tools 下发、tool 消息编码、响应 tool_calls 提取', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-2', object: 'chat.completion', created: 1755400000, model: 'gpt-4o',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'send_reply', arguments: '{"text":"好热"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    })
    const provider = createChatCompletionsProvider({
      id: 'p1', type: 'chat-completions', apiKey: 'sk-x', baseURL: 'https://api.example.com', model: 'gpt-4o',
    })
    const response = await provider.execute({
      messages: toolMessages,
      tools: [weatherTool],
      parallelToolCalls: false,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string)
    // 请求侧：tools 数组（OpenAI function 形态）
    expect(sentBody.tools).toEqual([{
      type: 'function',
      function: { name: 'get_weather', description: '查询城市天气', parameters: weatherTool.parameters },
    }])
    expect(sentBody.parallel_tool_calls).toBe(false)
    // 消息侧：assistant tool_calls 与 tool 回填
    expect(sentBody.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"上海"}' } }],
    })
    expect(sentBody.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"temp":26}' })

    // 响应侧：toolCalls 提取，assistant 回显携带 toolCalls
    expect(response.finishReason).toBe('tool_calls')
    expect(response.toolCalls).toEqual([
      { id: 'call_9', type: 'function', name: 'send_reply', arguments: '{"text":"好热"}' },
    ])
    expect(response.messages?.[3]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_9', type: 'function', name: 'send_reply', arguments: '{"text":"好热"}' }],
    })
  })

  it('anthropic：tools 下发为 input_schema、响应 tool_use 提取（对象参数）', async () => {
    const fetchMock = mockFetch({
      id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'send_reply', input: { text: '收到' } }],
      usage: { input_tokens: 5, output_tokens: 3 },
    })
    const provider = createAnthropicProvider({
      id: 'p2', type: 'anthropic', apiKey: 'k', baseURL: 'https://api.example.com', model: 'claude-x',
    })
    const response = await provider.execute({ messages: toolMessages, tools: [weatherTool] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.tools).toEqual([{
      name: 'get_weather',
      description: '查询城市天气',
      input_schema: weatherTool.parameters,
    }])
    // tool 结果 → tool_result block
    expect(sentBody.messages[2].content).toContainEqual({
      type: 'tool_result', tool_use_id: 'call_1', content: '{"temp":26}',
    })

    expect(response.finishReason).toBe('tool_calls')
    // P2-17：canonical 统一为 JSON 字符串（跨 provider 回灌不再丢失参数）
    expect(response.toolCalls).toEqual([
      { id: 'toolu_1', type: 'function', name: 'send_reply', arguments: '{"text":"收到"}' },
    ])
  })

  it('gemini：functionCall 响应提取（JSON 字符串参数）', async () => {
    const fetchMock = mockFetch({
      responseId: 'g2', modelVersion: 'gemini-x',
      candidates: [{
        content: { parts: [{ functionCall: { id: 'fc_1', name: 'stay_silent', args: { reason: '无事' } } }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    })
    const provider = createGeminiProvider({
      id: 'p3', type: 'gemini', apiKey: 'gk', baseURL: 'https://api.example.com', model: 'gemini-x',
    })
    const response = await provider.execute({ messages: toolMessages, tools: [weatherTool] })

    expect(response.toolCalls).toEqual([
      { id: 'fc_1', type: 'function', name: 'stay_silent', arguments: '{"reason":"无事"}' },
    ])
  })

  it('responses：function_call 输出项提取', async () => {
    const fetchMock = mockFetch({
      id: 'resp_2', object: 'response', status: 'completed', model: 'gpt-5', created_at: 1755400000,
      output: [{ id: 'fc_1', type: 'function_call', status: 'completed', call_id: 'call_7', name: 'send_reply', arguments: '{"text":"嗯"}' }],
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    })
    const provider = createResponsesProvider({
      id: 'p4', type: 'responses', apiKey: 'sk', baseURL: 'https://api.example.com', model: 'gpt-5',
    })
    const response = await provider.execute({ messages: toolMessages, tools: [weatherTool] })

    expect(response.toolCalls).toEqual([
      { id: 'call_7', type: 'function', name: 'send_reply', arguments: '{"text":"嗯"}' },
    ])
  })

  it('无 tools 请求不注入 tools 字段；无工具调用响应 toolCalls 为 undefined', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-3', object: 'chat.completion', created: 1755400000, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: '好' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const provider = createChatCompletionsProvider({
      id: 'p1', type: 'chat-completions', apiKey: 'sk-x', baseURL: 'https://api.example.com', model: 'gpt-4o',
    })
    const response = await provider.execute({ messages })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.tools).toBeUndefined()
    expect(sentBody.parallel_tool_calls).toBeUndefined()
    expect(response.toolCalls).toBeUndefined()
    expect(response.messages?.[2]).toEqual({ role: 'assistant', content: '好' })
  })
})
