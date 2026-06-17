/**
 * Phase 33 Provider Parity Productionization
 *
 * 验证 Gemini / Claude provider 与 OpenAI-compatible provider 在 gateway contract 下行为一致：
 * 1. 成功响应标准化 output / usage / finishReason / latency metadata
 * 2. HTTP 错误标准化为 ProviderError，并正确标记 retryable
 * 3. Gateway diagnostics 能记录 Gemini / Claude provider 成功调用
 * 4. Gemini / Claude retryable failure 能参与 fallback
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DefaultModelGatewayService,
  ProviderError,
  type GatewayDiagnostics,
} from '../packages/@elysia-ai/model-gateway/src/index.js'
import { createClaudeProvider } from '../packages/@elysia-ai/model-gateway/src/providers/claude.js'
import { createGeminiProvider } from '../packages/@elysia-ai/model-gateway/src/providers/gemini.js'

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

describe('Phase 33 Provider Parity Productionization', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('gemini provider should normalize successful ProviderResponse', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      modelVersion: 'gemini-1.5-pro-001',
      candidates: [
        {
          content: {
            parts: [
              { text: 'Gemini ' },
              { text: 'ok' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
        totalTokenCount: 18,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createGeminiProvider({
      id: 'slot:gemini',
      type: 'gemini',
      apiKey: 'gemini-key',
      endpoint: 'https://gemini.example/v1beta/',
      model: 'gemini-1.5-pro',
      maxTokens: 256,
      temperature: 0.3,
      timeoutMs: 1000,
    })

    const result = await provider.execute({
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello' },
      ],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gemini.example/v1beta/models/gemini-1.5-pro:generateContent?key=gemini-key')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.3,
      },
      systemInstruction: {
        parts: [{ text: 'system prompt' }],
      },
    })

    expect(result.output).toBe('Gemini ok')
    expect(result.provider).toMatchObject({
      id: 'slot:gemini',
      type: 'gemini',
      model: 'gemini-1.5-pro',
      endpoint: 'https://gemini.example/v1beta',
    })
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    })
    expect(result.finishReason).toBe('stop')
    expect(result.latencyMs).toEqual(expect.any(Number))
    expect(result.metadata).toMatchObject({
      modelVersion: 'gemini-1.5-pro-001',
      providerLatencyMs: expect.any(Number),
      latencyMs: expect.any(Number),
    })
  })

  it('claude provider should normalize successful ProviderResponse', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      id: 'msg_phase33',
      model: 'claude-3-5-sonnet-20241022',
      content: [
        { type: 'text', text: 'Claude ' },
        { type: 'text', text: 'ok' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 13,
        output_tokens: 5,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createClaudeProvider({
      id: 'slot:claude',
      type: 'claude',
      apiKey: 'claude-key',
      endpoint: 'https://claude.example/v1/',
      model: 'claude-3-5-sonnet',
      maxTokens: 128,
      temperature: 0.2,
      timeoutMs: 1000,
    })

    const result = await provider.execute({
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello' },
      ],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://claude.example/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'x-api-key': 'claude-key',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    })

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: 'claude-3-5-sonnet',
      max_tokens: 128,
      temperature: 0.2,
      system: 'system prompt',
      messages: [
        { role: 'user', content: 'hello' },
      ],
    })

    expect(result.output).toBe('Claude ok')
    expect(result.provider).toMatchObject({
      id: 'slot:claude',
      type: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      endpoint: 'https://claude.example/v1',
    })
    expect(result.usage).toEqual({
      inputTokens: 13,
      outputTokens: 5,
      totalTokens: 18,
    })
    expect(result.finishReason).toBe('stop')
    expect(result.latencyMs).toEqual(expect.any(Number))
    expect(result.metadata).toMatchObject({
      responseId: 'msg_phase33',
      model: 'claude-3-5-sonnet-20241022',
      providerLatencyMs: expect.any(Number),
      latencyMs: expect.any(Number),
    })
  })

  it('gemini provider should classify retryable and non-retryable HTTP errors', async () => {
    const provider = createGeminiProvider({
      id: 'slot:gemini',
      type: 'gemini',
      apiKey: 'gemini-key',
      endpoint: 'https://gemini.example/v1beta',
      model: 'gemini-1.5-pro',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { message: 'rate limited' } },
      { status: 429, statusText: 'Too Many Requests' },
    )))

    await expect(provider.execute({
      messages: [{ role: 'user', content: 'retryable' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:gemini',
      statusCode: 429,
      code: 'http-429',
      retryable: true,
      responseBody: { error: { message: 'rate limited' } },
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { message: 'bad request' } },
      { status: 400, statusText: 'Bad Request' },
    )))

    await expect(provider.execute({
      messages: [{ role: 'user', content: 'non-retryable' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:gemini',
      statusCode: 400,
      code: 'http-400',
      retryable: false,
      responseBody: { error: { message: 'bad request' } },
    })
  })

  it('claude provider should classify retryable overload and non-retryable auth errors', async () => {
    const provider = createClaudeProvider({
      id: 'slot:claude',
      type: 'claude',
      apiKey: 'claude-key',
      endpoint: 'https://claude.example/v1',
      model: 'claude-3-5-sonnet',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { type: 'overloaded_error', message: 'overloaded' } },
      { status: 529, statusText: 'Overloaded' },
    )))

    await expect(provider.execute({
      messages: [{ role: 'user', content: 'overload' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:claude',
      statusCode: 529,
      code: 'http-529',
      retryable: true,
      responseBody: { error: { type: 'overloaded_error', message: 'overloaded' } },
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { type: 'authentication_error', message: 'invalid key' } },
      { status: 401, statusText: 'Unauthorized' },
    )))

    await expect(provider.execute({
      messages: [{ role: 'user', content: 'auth' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:claude',
      statusCode: 401,
      code: 'http-401',
      retryable: false,
      responseBody: { error: { type: 'authentication_error', message: 'invalid key' } },
    })
  })

  it('gateway diagnostics should record gemini and claude provider success', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('gemini')) {
        return jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: 'gemini gateway ok' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 6,
            totalTokenCount: 10,
          },
        })
      }

      return jsonResponse({
        id: 'msg_gateway',
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'claude gateway ok' }],
        stop_reason: 'max_tokens',
        usage: {
          input_tokens: 8,
          output_tokens: 9,
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gateway = new DefaultModelGatewayService({
      slots: {
        gemini: {
          type: 'gemini',
          apiKey: 'gemini-key',
          endpoint: 'https://gemini.example/v1beta',
          model: 'gemini-1.5-pro',
        },
        claude: {
          type: 'claude',
          apiKey: 'claude-key',
          endpoint: 'https://claude.example/v1',
          model: 'claude-3-5-sonnet',
        },
      },
      defaultSlot: 'gemini',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const geminiResult = await gateway.execute({
      task: 'gemini-diagnostics',
      slot: 'gemini',
      messages: [{ role: 'user', content: 'gemini' }],
    })
    const geminiDiagnostics = geminiResult.metadata?.gatewayDiagnostics as GatewayDiagnostics

    expect(geminiResult.output).toBe('gemini gateway ok')
    expect(geminiResult.finishReason).toBe('length')
    expect(geminiDiagnostics.route).toMatchObject({
      slot: 'gemini',
      providerId: 'slot:gemini',
      providerType: 'gemini',
      model: 'gemini-1.5-pro',
    })
    expect(geminiDiagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:gemini',
      ok: true,
      latencyMs: expect.any(Number),
    })

    const claudeResult = await gateway.execute({
      task: 'claude-diagnostics',
      slot: 'claude',
      messages: [{ role: 'user', content: 'claude' }],
    })
    const claudeDiagnostics = claudeResult.metadata?.gatewayDiagnostics as GatewayDiagnostics

    expect(claudeResult.output).toBe('claude gateway ok')
    expect(claudeResult.finishReason).toBe('length')
    expect(claudeDiagnostics.route).toMatchObject({
      slot: 'claude',
      providerId: 'slot:claude',
      providerType: 'claude',
      model: 'claude-3-5-sonnet',
    })
    expect(claudeDiagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:claude',
      ok: true,
      latencyMs: expect.any(Number),
    })
  })

  it('gateway should fallback from retryable gemini and claude provider errors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('gemini')) {
        return jsonResponse(
          { error: { message: 'gemini unavailable' } },
          { status: 503, statusText: 'Unavailable' },
        )
      }

      if (url.includes('claude')) {
        return jsonResponse(
          { error: { type: 'overloaded_error', message: 'claude overloaded' } },
          { status: 529, statusText: 'Overloaded' },
        )
      }

      return jsonResponse({
        id: 'chatcmpl-fallback',
        choices: [
          {
            message: { role: 'assistant', content: 'fallback ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gateway = new DefaultModelGatewayService({
      slots: {
        gemini: {
          type: 'gemini',
          apiKey: 'gemini-key',
          endpoint: 'https://gemini.example/v1beta',
          model: 'gemini-1.5-pro',
        },
        claude: {
          type: 'claude',
          apiKey: 'claude-key',
          endpoint: 'https://claude.example/v1',
          model: 'claude-3-5-sonnet',
        },
        fast: {
          type: 'openai-compatible',
          apiKey: 'fast-key',
          endpoint: 'https://compatible.example/v1',
          model: 'fast-model',
        },
      },
      defaultSlot: 'gemini',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fallback: {
        enabled: true,
        slots: {
          gemini: ['fast'],
          claude: ['fast'],
        },
      },
    })

    const geminiResult = await gateway.execute({
      task: 'gemini-fallback',
      slot: 'gemini',
      messages: [{ role: 'user', content: 'gemini fallback' }],
    })
    const geminiDiagnostics = geminiResult.metadata?.gatewayDiagnostics as GatewayDiagnostics

    expect(geminiResult.output).toBe('fallback ok')
    expect(geminiDiagnostics).toMatchObject({
      failedOver: true,
      fallbackChain: ['gemini', 'fast'],
      selectedFallbackSlot: 'fast',
    })
    expect(geminiDiagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:gemini',
      ok: false,
      errorCode: 'http-503',
      retryable: true,
    })

    const claudeResult = await gateway.execute({
      task: 'claude-fallback',
      slot: 'claude',
      messages: [{ role: 'user', content: 'claude fallback' }],
    })
    const claudeDiagnostics = claudeResult.metadata?.gatewayDiagnostics as GatewayDiagnostics

    expect(claudeResult.output).toBe('fallback ok')
    expect(claudeDiagnostics).toMatchObject({
      failedOver: true,
      fallbackChain: ['claude', 'fast'],
      selectedFallbackSlot: 'fast',
    })
    expect(claudeDiagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:claude',
      ok: false,
      errorCode: 'http-529',
      retryable: true,
    })
  })
})
