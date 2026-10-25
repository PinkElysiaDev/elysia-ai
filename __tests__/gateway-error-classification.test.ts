import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerErrorRetryable } from '../packages/@elysia-ai/model-gateway/src/providers/utils.js'
import { ProviderError } from '../packages/@elysia-ai/model-gateway/src/providers/types.js'
import { createChatCompletionsProvider } from '../packages/@elysia-ai/model-gateway/src/providers/chat-completions.js'
import { createAnthropicProvider } from '../packages/@elysia-ai/model-gateway/src/providers/anthropic.js'
import { createGeminiProvider } from '../packages/@elysia-ai/model-gateway/src/providers/gemini.js'
import { createResponsesProvider } from '../packages/@elysia-ai/model-gateway/src/providers/responses.js'
import { recordGatewayAttemptFailure, createGatewayDiagnostics } from '../packages/@elysia-ai/model-gateway/src/diagnostics/index.js'
import { ProviderHealthTracker } from '../packages/@elysia-ai/model-gateway/src/health/index.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'

/**
 * maheshvara 0.3.0 错误协议层接入 gateway 的回归：
 * 四线制错误体 → 稳定 class + 真实 message + class 驱动的重试判定；
 * class 贯穿 ProviderError / 诊断 / 熔断健康快照 / observatory 记录。
 */

function mockJsonResponse(status: number, body: unknown, statusText = '') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => text,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const BASE_CONFIG = {
  id: 'test-provider',
  apiKey: 'sk-test',
  baseURL: 'https://api.example.com',
  model: 'test-model',
} as const

const SIMPLE_REQUEST = { messages: [{ role: 'user', content: 'hi' }] }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('providerErrorRetryable：class 驱动的重试判定', () => {
  it('可重试分类', () => {
    expect(providerErrorRetryable(429, 'rate_limit')).toBe(true)
    expect(providerErrorRetryable(529, 'overloaded')).toBe(true)
    expect(providerErrorRetryable(502, 'upstream')).toBe(true)
    expect(providerErrorRetryable(500, 'server')).toBe(true)
  })

  it('配置类分类不可重试', () => {
    expect(providerErrorRetryable(401, 'authentication')).toBe(false)
    expect(providerErrorRetryable(403, 'permission')).toBe(false)
    expect(providerErrorRetryable(404, 'model_not_found')).toBe(false)
    // 5xx 状态但错误体是配置类：降级为不可重试（Go 防重试风暴意图）。
    expect(providerErrorRetryable(500, 'authentication')).toBe(false)
    expect(providerErrorRetryable(500, 'invalid_request')).toBe(false)
  })

  it('invalid_request 仅超时/冲突/无状态码保持历史可重试行为', () => {
    expect(providerErrorRetryable(408, 'invalid_request')).toBe(true)
    expect(providerErrorRetryable(409, 'invalid_request')).toBe(true)
    expect(providerErrorRetryable(undefined, 'invalid_request')).toBe(true)
    expect(providerErrorRetryable(400, 'invalid_request')).toBe(false)
  })

  it('无 class 回退纯状态码判定', () => {
    expect(providerErrorRetryable(429, undefined)).toBe(true)
    expect(providerErrorRetryable(400, undefined)).toBe(false)
    expect(providerErrorRetryable(undefined, undefined)).toBe(true)
  })
})

describe('四线制错误体解析接入 provider', () => {
  it('chat-completions 429：class=rate_limit，message 用上游真实文案', async () => {
    mockJsonResponse(429, { error: { message: 'Rate limited, slow down', type: 'rate_limit_error', code: 'slow_down' } })
    const provider = createChatCompletionsProvider({ ...BASE_CONFIG, type: 'chat-completions' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    const providerError = error as ProviderError
    expect(providerError.class).toBe('rate_limit')
    expect(providerError.retryable).toBe(true)
    expect(providerError.code).toBe('http-429')
    expect(providerError.statusCode).toBe(429)
    expect(providerError.message).toContain('Rate limited, slow down')
    expect(providerError.message).toContain('rate_limit')
  })

  it('anthropic 529：class=overloaded 可重试；401：class=authentication 不可重试', async () => {
    mockJsonResponse(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
    const anthropic = createAnthropicProvider({ ...BASE_CONFIG, type: 'anthropic' })
    const overloaded = await anthropic.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(overloaded.class).toBe('overloaded')
    expect(overloaded.retryable).toBe(true)

    mockJsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    const unauthorized = await anthropic.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(unauthorized.class).toBe('authentication')
    expect(unauthorized.retryable).toBe(false)
    expect(unauthorized.message).toContain('invalid x-api-key')
  })

  it('gemini 400：gRPC INVALID_ARGUMENT → class=invalid_request 不可重试', async () => {
    mockJsonResponse(400, { error: { code: 400, message: 'Please use a valid role.', status: 'INVALID_ARGUMENT' } })
    const provider = createGeminiProvider({ ...BASE_CONFIG, type: 'gemini' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('invalid_request')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('Please use a valid role.')
  })

  it('responses 500 + invalid_request_error body：OpenAI 线按状态分类（class=upstream，可重试）', async () => {
    // Go ParseUpstreamError 的 OpenAI 分支不按 error.type 分类（OpenAI 已废弃
    // type 细分，细分走 code）——分类来自状态码：500 → upstream。
    mockJsonResponse(500, { error: { message: 'Invalid schema for response_format', type: 'invalid_request_error', param: 'response_format', code: null } })
    const provider = createResponsesProvider({ ...BASE_CONFIG, type: 'responses' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('upstream')
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('Invalid schema for response_format')
  })

  it('anthropic 500 且错误体为 authentication_error：body type 参与分类并降级为不可重试', async () => {
    // Claude/Gemini 的 error.type/status 参与 ParseUpstreamError 分类——
    // 5xx 状态 + 配置类分类时尊重分类（Go 防重试风暴意图）。
    mockJsonResponse(500, { type: 'error', error: { type: 'authentication_error', message: 'invalid api key' } })
    const provider = createAnthropicProvider({ ...BASE_CONFIG, type: 'anthropic' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('authentication')
    expect(error.retryable).toBe(false)
  })

  it('408 空 body：class 按状态反推为 invalid_request，但保持可重试', async () => {
    mockJsonResponse(408, '')
    const provider = createChatCompletionsProvider({ ...BASE_CONFIG, type: 'chat-completions' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('invalid_request')
    expect(error.retryable).toBe(true)
  })

  it('502 HTML body：class=upstream 可重试，message 回退状态文案', async () => {
    mockJsonResponse(502, '<html>Bad Gateway</html>', 'Bad Gateway')
    const provider = createChatCompletionsProvider({ ...BASE_CONFIG, type: 'chat-completions' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('upstream')
    expect(error.retryable).toBe(true)
    expect(error.message).toBe('Chat Completions API failed: 502 Bad Gateway')
  })

  it('HTTP 200 但 body 带 error：message 用上游文案，class 按状态 0 推导', async () => {
    mockJsonResponse(200, { id: 'x', error: { message: 'Quota exceeded', type: 'insufficient_quota', code: 'insufficient_quota' } })
    const provider = createChatCompletionsProvider({ ...BASE_CONFIG, type: 'chat-completions' })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    // 无状态码 → classFromStatus(0) → invalid_request（对齐 Go ParseUpstreamError）。
    expect(error.class).toBe('invalid_request')
    expect(error.code).toBe('api-error')
    expect(error.message).toContain('Quota exceeded')
  })
})

describe('class 贯穿诊断与健康链路', () => {
  it('诊断 attempt 记录 errorClass', () => {
    const diagnostics = createGatewayDiagnostics(
      { messages: [] } as never,
      { provider: { id: 'p', type: 'chat-completions', model: 'm' } } as never,
    )
    const error = new ProviderError('boom', 'p', 429, null, { retryable: true, code: 'http-429', class: 'rate_limit' })
    recordGatewayAttemptFailure(diagnostics, { providerId: 'p', attempt: 0, startedAt: Date.now(), error })
    expect(diagnostics.attempts[0].errorClass).toBe('rate_limit')
  })

  it('健康快照记录 lastErrorClass', () => {
    const tracker = new ProviderHealthTracker()
    tracker.recordFailure('p', new ProviderError('bad key', 'p', 401, null, { retryable: false, code: 'http-401', class: 'authentication' }))
    expect(tracker.getSnapshot('p').lastErrorClass).toBe('authentication')
    expect(tracker.getSnapshot('p').lastErrorCode).toBe('http-401')
  })

  it('observatory：byErrorClass 聚合与 recentFailures.errorClass；summarizeError 保留 class', () => {
    const service = new DefaultObservatoryService()
    const record = (id: string, errorClass?: string) => ({
      id,
      kind: 'gateway',
      event: 'gateway.failed',
      timestamp: Date.now(),
      status: 'failed',
      summary: id,
      metadata: {
        diagnostics: {
          route: { providerId: 'p1', providerType: 'chat-completions', model: 'm' },
          finalErrorCode: 'http-429',
          attempts: [{ providerId: 'p1', attempt: 0, startedAt: Date.now(), ok: false, errorCode: 'http-429', errorClass, retryable: true }],
          attemptsTotal: 1,
        },
      },
    })
    ;(service as unknown as { record(r: unknown): void }).record(record('f1', 'rate_limit'))
    ;(service as unknown as { record(r: unknown): void }).record(record('f2', 'rate_limit'))
    ;(service as unknown as { record(r: unknown): void }).record(record('f3', 'authentication'))

    const analytics = service.getGatewayAnalytics()
    expect(analytics.byErrorClass).toEqual({ rate_limit: 2, authentication: 1 })
    expect(analytics.recentFailures.at(-1)?.errorClass).toBe('authentication')

    // ProviderError 直接作为事件载荷：summarizeError 保留 class（非文本，不脱敏）。
    service.recordEvent('gateway.failed', {
      error: new ProviderError('boom', 'p1', 429, null, { retryable: true, code: 'http-429', class: 'overloaded' }),
    })
    const serialized = JSON.stringify(service.getRecentEvents(20))
    expect(serialized).toContain('overloaded')
  })
})
