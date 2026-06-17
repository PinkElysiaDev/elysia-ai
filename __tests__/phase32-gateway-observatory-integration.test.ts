/**
 * Phase 32 Gateway Observatory Integration
 *
 * 验证 model-gateway 将 runtime governance 数据旁路输出给 observatory：
 * 1. gateway.responded event 携带 diagnostics 与 healthSnapshots
 * 2. gateway.failed event 携带 diagnostics 与 healthSnapshots
 * 3. fallback 成功 trace 记录 failedOver / fallbackChain / selectedFallbackSlot
 * 4. circuit-open fallback trace 记录 circuit-open attempt 与最终 fallback provider
 */

import { describe, expect, it, vi } from 'vitest'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/index.js'
import {
  DefaultModelGatewayService,
  ProviderError,
  type GatewayDiagnostics,
  type ProviderHealthSnapshot,
} from '../packages/@elysia-ai/model-gateway/src/index.js'

function makeProviderResponse(providerId: string, output = 'ok', latencyMs = 7) {
  return {
    output,
    messages: [{ role: 'assistant' as const, content: output }],
    provider: {
      id: providerId,
      type: 'openai-compatible' as const,
      model: 'observatory-model',
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

function createObservatoryEventBus(service: DefaultObservatoryService) {
  return {
    async emit(event: string, payload: unknown) {
      service.recordEvent(event, payload)
    },
  }
}

function getMetadata<T = Record<string, unknown>>(record: { metadata?: Record<string, unknown> } | undefined): T {
  expect(record?.metadata).toBeDefined()
  return record!.metadata as T
}

describe('Phase 32 Gateway Observatory Integration', () => {
  it('gateway.responded event should include diagnostics and health snapshots', async () => {
    const observatory = new DefaultObservatoryService()
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'observatory-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    }, createObservatoryEventBus(observatory) as any)

    const provider = gateway.getRegistry().resolveSlot('main')!
    provider.execute = vi.fn(async () => makeProviderResponse('slot:main', 'observed ok', 11))

    await gateway.execute({
      task: 'observatory-success',
      slot: 'main',
      messages: [{ role: 'user', content: 'observe success' }],
      metadata: {
        sourceStimulusIds: ['phase32-success'],
      },
    })

    const responded = observatory.getRecentEvents().find((event) => event.event === 'gateway.responded')
    const metadata = getMetadata<{
      diagnostics: GatewayDiagnostics
      healthSnapshots: ProviderHealthSnapshot[]
    }>(responded)

    expect(responded).toMatchObject({
      kind: 'gateway',
      status: 'responded',
      stimulusId: 'phase32-success',
    })
    expect(metadata.diagnostics.route).toMatchObject({
      slot: 'main',
      providerId: 'slot:main',
      providerType: 'openai-compatible',
      model: 'observatory-model',
      reason: 'slot-matched',
    })
    expect(metadata.diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:main',
      ok: true,
      latencyMs: 11,
    })
    expect(metadata.healthSnapshots).toHaveLength(1)
    expect(metadata.healthSnapshots[0]).toMatchObject({
      providerId: 'slot:main',
      status: 'healthy',
      recentSuccesses: 1,
      averageLatencyMs: 11,
    })
  })

  it('gateway.failed event should include diagnostics and health snapshots', async () => {
    const observatory = new DefaultObservatoryService()
    const gateway = new DefaultModelGatewayService({
      slots: {
        main: {
          type: 'openai-compatible',
          apiKey: 'key',
          endpoint: 'https://compatible.example/v1',
          model: 'observatory-model',
        },
      },
      defaultSlot: 'main',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    }, createObservatoryEventBus(observatory) as any)

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
      task: 'observatory-failed',
      slot: 'main',
      messages: [{ role: 'user', content: 'observe failure' }],
      metadata: {
        sourceStimulusIds: ['phase32-failed'],
      },
    })).rejects.toThrow(/failed after/)

    const failed = observatory.getRecentEvents().find((event) => event.event === 'gateway.failed')
    const metadata = getMetadata<{
      diagnostics: GatewayDiagnostics
      healthSnapshots: ProviderHealthSnapshot[]
    }>(failed)

    expect(failed).toMatchObject({
      kind: 'gateway',
      status: 'failed',
      stimulusId: 'phase32-failed',
    })
    expect(metadata.diagnostics.finalErrorCode).toBe('http-400')
    expect(metadata.diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:main',
      ok: false,
      errorCode: 'http-400',
      statusCode: 400,
      retryable: false,
    })
    expect(metadata.healthSnapshots[0]).toMatchObject({
      providerId: 'slot:main',
      recentFailures: 1,
      consecutiveFailures: 1,
      lastErrorCode: 'http-400',
    })
  })

  it('fallback success event should expose failedOver diagnostics and both provider health snapshots', async () => {
    const observatory = new DefaultObservatoryService()
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
    }, createObservatoryEventBus(observatory) as any)

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
    fastProvider.execute = vi.fn(async () => makeProviderResponse('slot:fast', 'fallback observed', 6))

    await gateway.execute({
      task: 'observatory-fallback',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'observe fallback' }],
      metadata: {
        sourceStimulusIds: ['phase32-fallback'],
      },
    })

    const responded = observatory.getRecentEvents().find((event) => event.event === 'gateway.responded')
    const metadata = getMetadata<{
      diagnostics: GatewayDiagnostics
      healthSnapshots: ProviderHealthSnapshot[]
    }>(responded)

    expect(metadata.diagnostics).toMatchObject({
      failedOver: true,
      fallbackChain: ['reasoning', 'fast'],
      selectedFallbackSlot: 'fast',
    })
    expect(metadata.diagnostics.route).toMatchObject({
      slot: 'fast',
      providerId: 'slot:fast',
      model: 'fast-model',
    })
    expect(metadata.diagnostics.attempts).toHaveLength(2)
    expect(metadata.diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:reasoning',
      ok: false,
      errorCode: 'http-503',
    })
    expect(metadata.diagnostics.attempts[1]).toMatchObject({
      providerId: 'slot:fast',
      ok: true,
      latencyMs: 6,
    })
    expect(metadata.healthSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'slot:reasoning',
        recentFailures: 1,
        lastErrorCode: 'http-503',
      }),
      expect.objectContaining({
        providerId: 'slot:fast',
        recentSuccesses: 1,
        averageLatencyMs: 6,
      }),
    ]))
  })

  it('circuit-open fallback event should expose circuit-open attempt and final fallback provider', async () => {
    const observatory = new DefaultObservatoryService()
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
    }, createObservatoryEventBus(observatory) as any)

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
    fastProvider.execute = vi.fn(async () => makeProviderResponse('slot:fast', 'circuit fallback observed', 8))

    await gateway.execute({
      task: 'observatory-open-circuit',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'open circuit' }],
      metadata: {
        sourceStimulusIds: ['phase32-circuit'],
      },
    })

    observatory.clear()

    await gateway.execute({
      task: 'observatory-circuit-fallback',
      slot: 'reasoning',
      messages: [{ role: 'user', content: 'circuit fallback' }],
      metadata: {
        sourceStimulusIds: ['phase32-circuit'],
      },
    })

    const responded = observatory.getRecentEvents().find((event) => event.event === 'gateway.responded')
    const metadata = getMetadata<{
      diagnostics: GatewayDiagnostics
      healthSnapshots: ProviderHealthSnapshot[]
    }>(responded)

    expect(reasoningProvider.execute).toHaveBeenCalledTimes(1)
    expect(fastProvider.execute).toHaveBeenCalledTimes(2)
    expect(metadata.diagnostics.failedOver).toBe(true)
    expect(metadata.diagnostics.selectedFallbackSlot).toBe('fast')
    expect(metadata.diagnostics.attempts[0]).toMatchObject({
      providerId: 'slot:reasoning',
      ok: false,
      errorCode: 'circuit-open',
      retryable: false,
    })
    expect(metadata.diagnostics.attempts[1]).toMatchObject({
      providerId: 'slot:fast',
      ok: true,
      latencyMs: 8,
    })
    expect(metadata.healthSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'slot:reasoning',
        status: 'circuit-open',
      }),
      expect.objectContaining({
        providerId: 'slot:fast',
        status: 'healthy',
        recentSuccesses: 2,
      }),
    ]))
  })
})
