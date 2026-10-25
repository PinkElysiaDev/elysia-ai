import { describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from '../packages/@elysia-ai/model-gateway/src/providers/utils.js'
import { ProviderError } from '../packages/@elysia-ai/model-gateway/src/providers/types.js'
import { createResponsesProvider } from '../packages/@elysia-ai/model-gateway/src/providers/responses.js'
import { createChatCompletionsProvider } from '../packages/@elysia-ai/model-gateway/src/providers/chat-completions.js'
import { createAnthropicProvider } from '../packages/@elysia-ai/model-gateway/src/providers/anthropic.js'
import { maheshvaraToolCallsToResponsesItems } from '../packages/@elysia-ai/protocol-responses/src/encode.js'
import { encodeChatCompletionsRequest } from '../packages/@elysia-ai/protocol-openai/src/encode.js'
import { usageFromRawMap } from '../packages/@elysia-ai/maheshvara/src/parts.js'

/** P2 协议层修复专项回归（P2-8/9/10/11/13/16/17 活跃与潜伏项）。 */

function mockFetch(payload: unknown, overrides: Partial<Response> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(payload),
    ...overrides,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('P2-8：body 读取纳入超时保护', () => {
  it('body 读取挂死被 abort 中断并映射为 timeout ProviderError（可重试）', async () => {
    let signal: AbortSignal | undefined
    // 响应头立即返回；body 读取 promise 只在 abort 时拒绝（模拟挂死的 body 流）
    const hangingResponse = {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    }
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal
      return Promise.resolve(hangingResponse)
    }))

    const wrapped = await fetchWithTimeout('https://x.example.com', {}, 150, 'p1')
    const error = await wrapped.json().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe('timeout')
    expect((error as ProviderError).retryable).toBe(true)
  })

  it('body 截断解析失败映射为 invalid-response（不可重试）', async () => {
    // 200 但 body 不是合法 JSON
    const res = new Response('<html>gateway error</html>', { status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    const wrapped = await fetchWithTimeout('https://x.example.com', {}, 1000, 'p1')
    await expect(wrapped.json()).rejects.toMatchObject({ code: 'invalid-response', retryable: false })
  })

  it('正常 body 读取后不误报', async () => {
    mockFetch({ ok: true })
    const wrapped = await fetchWithTimeout('https://x.example.com', {}, 1000, 'p1')
    await expect(wrapped.json()).resolves.toEqual({ ok: true })
  })
})

describe('P2-9/P2-10：熔断与重试语义', () => {
  it('一次请求多次 attempt 只记一次熔断失败（第二次请求仍真实发起）', async () => {
    const { DefaultModelGatewayService } = await import('../packages/@elysia-ai/model-gateway/src/index.js')
    const gateway = new DefaultModelGatewayService({
      providers: {
        p1: { type: 'chat-completions', apiKey: 'k', baseURL: 'https://api.example.com' },
      },
      providerSlots: { main: { provider: 'p1', model: 'm' } },
      defaultSlot: 'main',
      maxRetries: 2, baseDelayMs: 1,
    })
    // 单请求 3 连败（500 可重试）→ 若按 attempt 计数（旧行为）3 次 failure
    // 即触达默认阈值 3 → 熔断开启，第二次请求会直接 circuit-open 不发 fetch。
    // 修复后请求级计数：第一次请求只记 1 次失败，第二次请求仍真实发起。
    const fetchMock = mockFetch(null, { ok: false, status: 500, statusText: 'err', json: () => Promise.resolve({}) })
    await expect(gateway.execute({ slot: 'main', messages: [] })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(gateway.execute({ slot: 'main', messages: [] })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(6) // 第二次请求也发起了 3 次（未被熔断拦截）
  })

  it('SyntaxError 响应体不再重试（白名单）', async () => {
    const { DefaultModelGatewayService } = await import('../packages/@elysia-ai/model-gateway/src/index.js')
    const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new DefaultModelGatewayService({
      providers: {
        p1: { type: 'chat-completions', apiKey: 'k', baseURL: 'https://api.example.com' },
      },
      providerSlots: { main: { provider: 'p1', model: 'm' } },
      defaultSlot: 'main',
      maxRetries: 3, baseDelayMs: 1,
    })
    await expect(gateway.execute({ slot: 'main', messages: [] })).rejects.toMatchObject({ code: 'invalid-response' })
    // 200 坏 body 只请求一次（不重试）
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('P2-16：responses encode 合成 id', () => {
  it('缺 id 的工具调用合成确定性 id；缺 name 仍丢弃；对象参数 stringify', () => {
    const items = maheshvaraToolCallsToResponsesItems([
      { id: '', type: 'function', name: 'send_reply', arguments: { text: 'hi' } },
      { id: 'kept', type: 'function', name: 'stay_silent', arguments: '{"reason":"x"}' },
      { id: 'x', type: 'function', name: '', arguments: '{}' },
    ], 3)
    expect(items).toEqual([
      { type: 'function_call', call_id: 'call_3_0', name: 'send_reply', arguments: '{"text":"hi"}' },
      { type: 'function_call', call_id: 'kept', name: 'stay_silent', arguments: '{"reason":"x"}' },
    ])
  })

  it('provider 全链：无 id 工具调用不再被静默丢弃', async () => {
    const fetchMock = mockFetch({
      id: 'resp_1', object: 'response', status: 'completed', model: 'gpt-5', created_at: 1,
      output: [{ id: '', type: 'function_call', status: 'completed', call_id: '', name: 'send_reply', arguments: '{"text":"x"}' }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })
    const provider = createResponsesProvider({
      id: 'p', type: 'responses', apiKey: 'sk', baseURL: 'https://api.example.com', model: 'gpt-5',
    })
    const response = await provider.execute({ messages: [{ role: 'user', content: 'hi' }] })
    // encode 侧合成（call_N_M）已由单测覆盖；decode 侧透传上游空 id（上游病态输入）
    expect(response.toolCalls).toEqual([
      { id: undefined, type: 'function', name: 'send_reply', arguments: '{"text":"x"}' },
    ])
    void fetchMock
  })
})

describe('P2-17：跨 provider 工具参数往返不丢', () => {
  it('anthropic 响应（对象 input）→ openai 下一轮请求 encode 参数完整', async () => {
    // 1. anthropic 响应带对象参数工具调用
    mockFetch({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'send_reply', input: { text: '你好世界' } }],
      usage: { input_tokens: 3, output_tokens: 1 },
    })
    const anthropic = createAnthropicProvider({
      id: 'p2', type: 'anthropic', apiKey: 'k', baseURL: 'https://api.example.com', model: 'claude-x',
    })
    const first = await anthropic.execute({ messages: [{ role: 'user', content: 'hi' }] })
    // canonical 统一为字符串
    expect(first.toolCalls?.[0].arguments).toBe('{"text":"你好世界"}')

    // 2. 回灌 openai provider：assistant toolCalls + tool 结果
    vi.unstubAllGlobals()
    const fetchMock2 = mockFetch({
      id: 'c2', object: 'chat.completion', created: 1, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const openai = createChatCompletionsProvider({
      id: 'p1', type: 'chat-completions', apiKey: 'sk', baseURL: 'https://api.example.com', model: 'gpt-4o',
    })
    await openai.execute({
      messages: [
        ...first.messages!,
        { role: 'tool', toolCallId: 'toolu_1', name: 'send_reply', content: '{"ok":true}' },
      ],
    })
    const sentBody = JSON.parse((fetchMock2.mock.calls[0] as [string, RequestInit])[1].body as string)
    // 参数不丢：不再是 '{}'
    const sentCall = sentBody.messages.find((m: { tool_calls?: unknown[] }) => (m.tool_calls?.length ?? 0) > 0)
    expect(sentCall.tool_calls[0].function.arguments).toBe('{"text":"你好世界"}')
  })

  it('P2-13：usageFromRawMap 嵌套 cached_tokens 回退', () => {
    const usage = usageFromRawMap({
      prompt_tokens: 10, completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 7 },
    })
    expect(usage?.cached_input_tokens).toBe(7)
    const responsesStyle = usageFromRawMap({
      input_tokens: 8, output_tokens: 2,
      input_tokens_details: { cached_tokens: 4 },
    })
    expect(responsesStyle?.cached_input_tokens).toBe(4)
  })
})
