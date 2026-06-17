/**
 * Phase 31 Model Gateway Runtime Governance
 *
 * 验证 gateway runtime diagnostics：
 * 1. 成功请求输出 route / attempt / latency diagnostics
 * 2. retry 失败后成功会记录全部 attempts
 * 3. gateway.failed event 会携带 diagnostics
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DefaultModelGatewayService,
  ProviderError,
  ProviderHealthTracker,
  type GatewayDiagnostics,
} from '../packages/@elysia-ai/model-gateway/src/index.js'

function makeProviderResponse(providerId: string, output = 'ok', latencyMs = 7) {
  return {
    output,
    messages: [{ role: 'assistant' as const, content: output }],
    provider: {
      id: providerId,
      type: 'openai-compatible' as const,
      model: 'runtime-model',
    },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
    finishReason: 'stop',
    latencyMs,
    metadata: {
      providerLatencyMs: latencyMs,
    },
  }
}

function createEventBusRecorder() {
  const events: Record<string, any[]> = {}

  return {
    events,
    bus: {
      async emit(event: string, payload: any) {
        ;(events[event] ??= []).push(payload)
      },
    },
  }
}

describe('Phase 31 Model Gateway Runtime Governance', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('successful gateway response should include route and latency diagnostics', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => makeProviderResponse('slot:main', 'diagnostics ok', 12))

    const result = await gateway.execute({
      task: 'diagnostics-success',
      slot: 'main',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const diagnostics = result.metadata?.gatewayDiagnostics as GatewayDiagnostics
    expect(diagnostics).toBeDefined()
    expect(diagnostics.route).toMatchObject({
      slot: 'main',
      providerId: 'slot:main',
      providerType: 'openai-compatible',
      model: 'runtime-model',
      reason: 'slot-matched',
    })
    expect(diagnostics.attempts).toHaveLength(1)
    expect(diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:main',
      attempt: 0,
      ok: true,
      latencyMs: 12,
    })
    expect(diagnostics.retryCount).toBe(0)
    expect(diagnostics.totalLatencyMs).toEqual(expect.any(Number))
  })

  it('retry success should record all failed and successful attempts', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    let calls = 0
    provider.execute = vi.fn(async () => {
      calls++
      if (calls < 3) {
        throw new ProviderError(
          'temporary upstream failure',
          'slot:main',
          500,
          { error: 'upstream' },
          { retryable: true, code: 'http-500' },
        )
      }
      return makeProviderResponse('slot:main', 'retry diagnostics ok', 5)
    })

    const result = await gateway.execute({
      task: 'diagnostics-retry',
      slot: 'main',
      messages: [{ role: 'user', content: 'retry' }],
    })

    const diagnostics = result.metadata?.gatewayDiagnostics as GatewayDiagnostics
    expect(provider.execute).toHaveBeenCalledTimes(3)
    expect(diagnostics.attempts).toHaveLength(3)
    expect(diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:main',
      attempt: 0,
      ok: false,
      errorCode: 'http-500',
      statusCode: 500,
      retryable: true,
    })
    expect(diagnostics.attempts[1]).toMatchObject({
      providerId: 'slot:main',
      attempt: 1,
      ok: false,
      errorCode: 'http-500',
      statusCode: 500,
      retryable: true,
    })
    expect(diagnostics.attempts[2]).toMatchObject({
      providerId: 'slot:main',
      attempt: 2,
      ok: true,
      latencyMs: 5,
    })
    expect(diagnostics.retryCount).toBe(2)
    expect(diagnostics.finalErrorCode).toBe('http-500')
  })

  it('provider health tracker should record success latency and reset consecutive failures', () => {
    const tracker = new ProviderHealthTracker({
      degradedFailureThreshold: 2,
      unhealthyFailureThreshold: 4,
    })

    tracker.recordFailure('slot:main', new ProviderError(
      'temporary failure',
      'slot:main',
      500,
      undefined,
      { retryable: true, code: 'http-500' },
    ))
    tracker.recordSuccess('slot:main', 20)
    tracker.recordSuccess('slot:main', 40)

    const snapshot = tracker.getSnapshot('slot:main')
    expect(snapshot).toMatchObject({
      providerId: 'slot:main',
      status: 'healthy',
      recentSuccesses: 2,
      recentFailures: 1,
      consecutiveFailures: 0,
      lastErrorCode: 'http-500',
      averageLatencyMs: 30,
    })
    expect(snapshot.lastSuccessAt).toEqual(expect.any(Number))
    expect(snapshot.lastFailureAt).toEqual(expect.any(Number))
  })

  it('provider health tracker should mark provider degraded and unhealthy after repeated failures', () => {
    const tracker = new ProviderHealthTracker({
      degradedFailureThreshold: 2,
      unhealthyFailureThreshold: 3,
    })

    tracker.recordFailure('slot:main', new ProviderError(
      'failure 1',
      'slot:main',
      500,
      undefined,
      { retryable: true, code: 'http-500' },
    ))
    expect(tracker.getSnapshot('slot:main')).toMatchObject({
      status: 'healthy',
      consecutiveFailures: 1,
      recentFailures: 1,
      lastErrorCode: 'http-500',
    })

    tracker.recordFailure('slot:main', new ProviderError(
      'failure 2',
      'slot:main',
      429,
      undefined,
      { retryable: true, code: 'http-429' },
    ))
    expect(tracker.getSnapshot('slot:main')).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 2,
      recentFailures: 2,
      lastErrorCode: 'http-429',
    })

    tracker.recordFailure('slot:main', new ProviderError(
      'failure 3',
      'slot:main',
      503,
      undefined,
      { retryable: true, code: 'http-503' },
    ))
    expect(tracker.getSnapshot('slot:main')).toMatchObject({
      status: 'unhealthy',
      consecutiveFailures: 3,
      recentFailures: 3,
      lastErrorCode: 'http-503',
    })
  })

  it('gateway should expose provider health snapshots after success and failure', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    let calls = 0
    provider.execute = vi.fn(async () => {
      calls++
      if (calls === 1) {
        throw new ProviderError(
          'temporary upstream failure',
          'slot:main',
          500,
          { error: 'upstream' },
          { retryable: true, code: 'http-500' },
        )
      }
      return makeProviderResponse('slot:main', 'health ok', 10)
    })

    await gateway.execute({
      task: 'health-snapshots',
      slot: 'main',
      messages: [{ role: 'user', content: 'health' }],
    })

    const snapshot = gateway.getHealthSnapshot('slot:main')
    expect(snapshot).toMatchObject({
      providerId: 'slot:main',
      status: 'healthy',
      recentSuccesses: 1,
      recentFailures: 1,
      consecutiveFailures: 0,
      lastErrorCode: 'http-500',
      averageLatencyMs: 10,
    })
    expect(gateway.getHealthSnapshots()).toHaveLength(1)
  })

  it('circuit breaker should open after consecutive failures and skip provider execution', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      circuitBreaker: { enabled: true, failureThreshold: 2, cooldownMs: 30000 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => {
      throw new ProviderError(
        'upstream unavailable',
        'slot:main',
        503,
        { error: 'unavailable' },
        { retryable: true, code: 'http-503' },
      )
    })

    for (let i = 0; i < 2; i++) {
      await expect(gateway.execute({
        task: `circuit-open-${i}`,
        slot: 'main',
        messages: [{ role: 'user', content: 'fail' }],
      })).rejects.toThrow(/failed after/)
    }

    expect(gateway.getHealthSnapshot('slot:main')).toMatchObject({
      status: 'circuit-open',
      consecutiveFailures: 2,
      recentFailures: 2,
      lastErrorCode: 'http-503',
    })

    await expect(gateway.execute({
      task: 'circuit-open-skip',
      slot: 'main',
      messages: [{ role: 'user', content: 'skip' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:main',
      code: 'circuit-open',
      retryable: false,
    })

    expect(provider.execute).toHaveBeenCalledTimes(2)
  })

  it('circuit breaker should allow probe after cooldown and close on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 1000 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    let shouldFail = true
    provider.execute = vi.fn(async () => {
      if (shouldFail) {
        throw new ProviderError(
          'upstream unavailable',
          'slot:main',
          503,
          { error: 'unavailable' },
          { retryable: true, code: 'http-503' },
        )
      }
      return makeProviderResponse('slot:main', 'probe ok', 9)
    })

    await expect(gateway.execute({
      task: 'open-circuit',
      slot: 'main',
      messages: [{ role: 'user', content: 'fail' }],
    })).rejects.toThrow(/failed after/)

    expect(gateway.getHealthSnapshot('slot:main').status).toBe('circuit-open')

    shouldFail = false
    vi.advanceTimersByTime(1001)

    const result = await gateway.execute({
      task: 'probe-success',
      slot: 'main',
      messages: [{ role: 'user', content: 'probe' }],
    })

    expect(result.output).toBe('probe ok')
    expect(provider.execute).toHaveBeenCalledTimes(2)
    expect(gateway.getHealthSnapshot('slot:main')).toMatchObject({
      status: 'healthy',
      consecutiveFailures: 0,
      recentSuccesses: 1,
      averageLatencyMs: 9,
    })
  })

  it('circuit breaker should reopen when cooldown probe fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 1000 },
    })

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => {
      throw new ProviderError(
        'probe failed',
        'slot:main',
        503,
        { error: 'unavailable' },
        { retryable: true, code: 'http-503' },
      )
    })

    await expect(gateway.execute({
      task: 'open-circuit',
      slot: 'main',
      messages: [{ role: 'user', content: 'fail' }],
    })).rejects.toThrow(/failed after/)

    vi.advanceTimersByTime(1001)

    await expect(gateway.execute({
      task: 'probe-failed',
      slot: 'main',
      messages: [{ role: 'user', content: 'probe' }],
    })).rejects.toThrow(/failed after/)

    expect(provider.execute).toHaveBeenCalledTimes(2)
    expect(gateway.getHealthSnapshot('slot:main')).toMatchObject({
      status: 'circuit-open',
      consecutiveFailures: 2,
      recentFailures: 2,
      lastErrorCode: 'http-503',
    })
  })

  it('primary slot retryable failure should fallback to secondary slot', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        reasoning: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'reasoning-model',
        },
        fast: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'fast-model',
        },
      },
      defaultSlot: 'reasoning',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fallback: {
        enabled: true,
        slots: {
          reasoning: ['fast'],
        },
      },
    })

    const reasoningProvider = gateway.getRegistry().resolveSlot('reasoning')!
    const fastProvider = gateway.getRegistry().resolveSlot('fast')!

    reasoningProvider.execute = vi.fn(async () => {
      throw new ProviderError(
        'reasoning unavailable',
        'slot:reasoning',
        503,
        { error: 'unavailable' },
        { retryable: true, code: 'http-503' },
      )
    })
    fastProvider.execute = vi.fn(async () => makeProviderResponse('slot:fast', 'fallback ok', 6))

    const result = await gateway.execute({
      task: 'fallback-success',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'fallback' }],
    })

    const diagnostics = result.metadata?.gatewayDiagnostics as GatewayDiagnostics
    expect(result.output).toBe('fallback ok')
    expect(reasoningProvider.execute).toHaveBeenCalledTimes(1)
    expect(fastProvider.execute).toHaveBeenCalledTimes(1)
    expect(diagnostics).toMatchObject({
      failedOver: true,
      fallbackChain: ['reasoning', 'fast'],
      selectedFallbackSlot: 'fast',
    })
    expect(diagnostics.route).toMatchObject({
      slot: 'fast',
      providerId: 'slot:fast',
      model: 'fast-model',
    })
    expect(diagnostics.attempts).toHaveLength(2)
    expect(diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:reasoning',
      ok: false,
      errorCode: 'http-503',
    })
    expect(diagnostics.attempts[1]).toMatchObject({
      providerId: 'slot:fast',
      ok: true,
      latencyMs: 6,
    })
  })

  it('circuit-open primary slot should fallback without executing primary again', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        reasoning: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'reasoning-model',
        },
        fast: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'fast-model',
        },
      },
      defaultSlot: 'reasoning',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 30000 },
      fallback: {
        enabled: true,
        slots: {
          reasoning: ['fast'],
        },
      },
    })

    const reasoningProvider = gateway.getRegistry().resolveSlot('reasoning')!
    const fastProvider = gateway.getRegistry().resolveSlot('fast')!

    reasoningProvider.execute = vi.fn(async () => {
      throw new ProviderError(
        'reasoning unavailable',
        'slot:reasoning',
        503,
        { error: 'unavailable' },
        { retryable: true, code: 'http-503' },
      )
    })
    fastProvider.execute = vi.fn(async () => makeProviderResponse('slot:fast', 'circuit fallback ok', 8))

    const firstResult = await gateway.execute({
      task: 'open-circuit-and-fallback',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'first' }],
    })

    expect(firstResult.output).toBe('circuit fallback ok')
    expect(gateway.getHealthSnapshot('slot:reasoning').status).toBe('circuit-open')
    expect(reasoningProvider.execute).toHaveBeenCalledTimes(1)

    const secondResult = await gateway.execute({
      task: 'skip-open-circuit-and-fallback',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'second' }],
    })

    const diagnostics = secondResult.metadata?.gatewayDiagnostics as GatewayDiagnostics
    expect(secondResult.output).toBe('circuit fallback ok')
    expect(reasoningProvider.execute).toHaveBeenCalledTimes(1)
    expect(fastProvider.execute).toHaveBeenCalledTimes(2)
    expect(diagnostics.failedOver).toBe(true)
    expect(diagnostics.selectedFallbackSlot).toBe('fast')
    expect(diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:reasoning',
      ok: false,
      errorCode: 'circuit-open',
      retryable: false,
    })
  })

  it('non-retryable primary error should not fallback by default', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        reasoning: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'reasoning-model',
        },
        fast: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'fast-model',
        },
      },
      defaultSlot: 'reasoning',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fallback: {
        enabled: true,
        slots: {
          reasoning: ['fast'],
        },
      },
    })

    const reasoningProvider = gateway.getRegistry().resolveSlot('reasoning')!
    const fastProvider = gateway.getRegistry().resolveSlot('fast')!

    reasoningProvider.execute = vi.fn(async () => {
      throw new ProviderError(
        'bad request',
        'slot:reasoning',
        400,
        { error: 'bad_request' },
        { retryable: false, code: 'http-400' },
      )
    })
    fastProvider.execute = vi.fn(async () => makeProviderResponse('slot:fast', 'should not happen', 3))

    await expect(gateway.execute({
      task: 'non-retryable-no-fallback',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'bad' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      providerId: 'slot:reasoning',
      code: 'http-400',
      retryable: false,
    })

    expect(reasoningProvider.execute).toHaveBeenCalledTimes(1)
    expect(fastProvider.execute).not.toHaveBeenCalled()
  })

  it('all fallback slots failed should throw aggregate ProviderError', async () => {
    const gateway = new DefaultModelGatewayService({
      slots: {
        reasoning: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'reasoning-model',
        },
        balanced: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'balanced-model',
        },
        fast: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'fast-model',
        },
      },
      defaultSlot: 'reasoning',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fallback: {
        enabled: true,
        slots: {
          reasoning: ['balanced', 'fast'],
        },
      },
    })

    for (const slot of ['reasoning', 'balanced', 'fast']) {
      const provider = gateway.getRegistry().resolveSlot(slot)!
      provider.execute = vi.fn(async () => {
        throw new ProviderError(
          `${slot} unavailable`,
          `slot:${slot}`,
          503,
          { error: 'unavailable' },
          { retryable: true, code: 'http-503' },
        )
      })
    }

    await expect(gateway.execute({
      task: 'all-fallbacks-failed',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'all fail' }],
    })).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'all-fallbacks-failed',
      retryable: false,
      responseBody: {
        slots: ['reasoning', 'balanced', 'fast'],
        failures: expect.arrayContaining([
          expect.objectContaining({ slot: 'reasoning', providerId: 'slot:reasoning', code: 'http-503' }),
          expect.objectContaining({ slot: 'balanced', providerId: 'slot:balanced', code: 'http-503' }),
          expect.objectContaining({ slot: 'fast', providerId: 'slot:fast', code: 'http-503' }),
        ]),
      },
    })
  })

  it('gateway.failed event should expose diagnostics metadata', async () => {
    const recorder = createEventBusRecorder()
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'runtime-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    }, recorder.bus as any)

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => {
      throw new ProviderError(
        'invalid request',
        'slot:main',
        400,
        { error: 'invalid' },
        { retryable: false, code: 'http-400' },
      )
    })

    await expect(gateway.execute({
      task: 'diagnostics-failed-event',
      slot: 'main',
      messages: [{ role: 'user', content: 'fail' }],
    })).rejects.toThrow(/failed after/)

    expect(recorder.events['gateway.failed']).toHaveLength(1)
    const failedPayload = recorder.events['gateway.failed'][0]
    const diagnostics = failedPayload.diagnostics as GatewayDiagnostics

    expect(diagnostics.route).toMatchObject({
      slot: 'main',
      providerId: 'slot:main',
      providerType: 'openai-compatible',
      model: 'runtime-model',
      reason: 'slot-matched',
    })
    expect(diagnostics.attempts).toHaveLength(1)
    expect(diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:main',
      attempt: 0,
      ok: false,
      errorCode: 'http-400',
      statusCode: 400,
      retryable: false,
    })
    expect(diagnostics.retryCount).toBe(0)
    expect(diagnostics.finalErrorCode).toBe('http-400')
  })
})
