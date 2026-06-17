/**
 * Phase 30 Model Gateway Provider Governance
 *
 * 验证 provider 生产化治理能力：
 * 1. OpenAI-compatible provider 继承 OpenAI chat-completions 协议并保持 provider descriptor 语义
 * 2. ProviderError.retryable 驱动 gateway retry 策略，非可重试错误不会重复调用
 * 3. slot/request metadata 可覆盖 provider 请求参数（maxTokens / temperature / timeoutMs）
 * 4. provider response 携带 latency diagnostics
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefaultModelGatewayService, ProviderError } from '../packages/@elysia-ai/model-gateway/src/index.js'
import { createOpenAICompatibleProvider } from '../packages/@elysia-ai/model-gateway/src/providers/openai-compatible.js'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

describe('Phase 30 Model Gateway Provider Governance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('openai-compatible provider should call chat/completions and preserve compatible provider descriptor', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      id: 'chatcmpl-phase30',
      created: 123,
      choices: [
        {
          message: { role: 'assistant', content: 'compatible ok' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createOpenAICompatibleProvider({
      id: 'slot:compatible',
      type: 'openai-compatible',
      apiKey: 'secret-key',
      endpoint: 'https://compatible.example/v1/',
      model: 'compatible-model',
      maxTokens: 128,
      temperature: 0.2,
      timeoutMs: 1000,
    })

    const result = await provider.execute({
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://compatible.example/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Authorization': 'Bearer secret-key',
      'Content-Type': 'application/json',
    })

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: 'compatible-model',
      max_tokens: 128,
      temperature: 0.2,
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(result.output).toBe('compatible ok')
    expect(result.provider).toMatchObject({
      id: 'slot:compatible',
      type: 'openai-compatible',
      model: 'compatible-model',
      endpoint: 'https://compatible.example/v1',
    })
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    })
    expect(result.latencyMs).toEqual(expect.any(Number))
    expect(result.metadata?.latencyMs).toEqual(expect.any(Number))
  })

  it('gateway should not retry non-retryable provider errors', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'm',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => {
      throw new ProviderError(
        'bad request',
        'slot:main',
        400,
        { error: 'invalid_request' },
        { retryable: false, code: 'http-400' },
      )
    })

    await expect(gateway.execute({
      task: 'non-retryable',
      slot: 'main',
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:main',
      statusCode: 400,
      code: 'http-400',
      retryable: false,
    })

    expect(provider.execute).toHaveBeenCalledTimes(1)
  })

  it('gateway should forward request metadata overrides to provider request', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'slot-model',
          maxTokens: 4096,
          temperature: 0.7,
          timeoutMs: 3000,
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async (request) => ({
      output: 'ok',
      messages: [{ role: 'assistant' as const, content: 'ok' }],
      provider: {
        id: 'slot:main',
        type: 'openai-compatible' as const,
        model: request.model ?? 'slot-model',
      },
      finishReason: 'stop',
      metadata: {},
    }))

    await gateway.execute({
      task: 'metadata-overrides',
      slot: 'main',
      messages: [{ role: 'user', content: 'test' }],
      metadata: {
        maxTokens: 256,
        temperature: 0.1,
        timeoutMs: 1500,
      },
    })

    expect(provider.execute).toHaveBeenCalledWith(expect.objectContaining({
      model: 'slot-model',
      maxTokens: 256,
      temperature: 0.1,
      timeoutMs: 1500,
      metadata: {
        maxTokens: 256,
        temperature: 0.1,
        timeoutMs: 1500,
      },
    }))
  })
})
