/**
 * Phase 35 Observatory Query & Gateway Failure Analytics
 *
 * 验证 observatory 提供面向运行时排障的查询与 gateway analytics 能力：
 * 1. queryEvents 支持 kind / event / status / stimulusId / taskId / time range / limit
 * 2. queryEvents 支持 providerId / errorCode 从 gateway diagnostics metadata 中查询
 * 3. getGatewayFailures 标准化 gateway.failed 失败摘要
 * 4. getGatewayAnalytics 聚合 gateway 请求、响应、失败、fallback、circuit-open 指标
 * 5. getSnapshot 附带 gatewayAnalytics，同时保持原有 snapshot 统计兼容
 */

import { describe, expect, it } from 'vitest'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'
import type { ObservedEventRecord } from '../packages/@elysia-ai/observatory/src/types.js'

function createRecord(
  id: string,
  overrides: Partial<ObservedEventRecord> = {},
): ObservedEventRecord {
  return {
    id,
    kind: 'runtime',
    event: 'runtime.completed',
    timestamp: Date.now(),
    status: 'completed',
    summary: id,
    ...overrides,
  }
}

function createGatewayRecord(
  id: string,
  event: 'gateway.requested' | 'gateway.responded' | 'gateway.failed',
  diagnostics: Record<string, unknown> = {},
  overrides: Partial<ObservedEventRecord> = {},
): ObservedEventRecord {
  return createRecord(id, {
    kind: 'gateway',
    event,
    status: event === 'gateway.failed'
      ? 'failed'
      : event === 'gateway.responded'
        ? 'responded'
        : 'requested',
    metadata: {
      diagnostics,
    },
    ...overrides,
  })
}

describe('Phase 35 Observatory Query & Gateway Failure Analytics', () => {
  it('queryEvents should filter by basic observatory fields and preserve latest limit order', () => {
    const service = new DefaultObservatoryService()
    const now = Date.now()

    service.record(createRecord('runtime-old', {
      kind: 'runtime',
      event: 'runtime.started',
      status: 'started',
      timestamp: now - 1000,
    }))
    service.record(createRecord('stimulus-1', {
      kind: 'stimulus',
      event: 'stimulus.received',
      status: 'received',
      stimulusId: 'stimulus-a',
      taskId: 'task-a',
      timestamp: now,
    }))
    service.record(createRecord('dialogue-1', {
      kind: 'dialogue',
      event: 'dialogue.completed',
      status: 'completed',
      stimulusId: 'stimulus-a',
      taskId: 'task-a',
      timestamp: now + 1,
    }))
    service.record(createRecord('dialogue-2', {
      kind: 'dialogue',
      event: 'dialogue.completed',
      status: 'completed',
      stimulusId: 'stimulus-b',
      taskId: 'task-b',
      timestamp: now + 2,
    }))

    expect(service.queryEvents({ kind: 'dialogue' }).map((event) => event.id)).toEqual([
      'dialogue-1',
      'dialogue-2',
    ])
    expect(service.queryEvents({ event: 'stimulus.received' }).map((event) => event.id)).toEqual([
      'stimulus-1',
    ])
    expect(service.queryEvents({ status: 'completed', stimulusId: 'stimulus-a' }).map((event) => event.id)).toEqual([
      'dialogue-1',
    ])
    expect(service.queryEvents({ taskId: 'task-b' }).map((event) => event.id)).toEqual([
      'dialogue-2',
    ])
    expect(service.queryEvents({ since: now, until: now + 1 }).map((event) => event.id)).toEqual([
      'stimulus-1',
      'dialogue-1',
    ])
    expect(service.queryEvents({ kind: 'dialogue', limit: 1 }).map((event) => event.id)).toEqual([
      'dialogue-2',
    ])
  })

  it('queryEvents should filter gateway records by providerId and errorCode from diagnostics metadata', () => {
    const service = new DefaultObservatoryService()

    service.record(createGatewayRecord('gateway-success', 'gateway.responded', {
      route: {
        providerId: 'slot:fast',
        providerType: 'openai-compatible',
      },
    }))
    service.record(createGatewayRecord('gateway-failed-reasoning', 'gateway.failed', {
      route: {
        providerId: 'slot:reasoning',
        providerType: 'gemini',
      },
      finalErrorCode: 'http-503',
      attempts: [
        {
          providerId: 'slot:reasoning',
          errorCode: 'http-503',
        },
      ],
    }))
    service.record(createGatewayRecord('gateway-failed-fast', 'gateway.failed', {
      route: {
        providerId: 'slot:fast',
        providerType: 'openai-compatible',
      },
      finalErrorCode: 'timeout',
      attempts: [
        {
          providerId: 'slot:fast',
          errorCode: 'timeout',
        },
      ],
    }))

    expect(service.queryEvents({ providerId: 'slot:reasoning' }).map((event) => event.id)).toEqual([
      'gateway-failed-reasoning',
    ])
    expect(service.queryEvents({ errorCode: 'timeout' }).map((event) => event.id)).toEqual([
      'gateway-failed-fast',
    ])
    expect(service.queryEvents({
      kind: 'gateway',
      status: 'failed',
      providerId: 'slot:fast',
      errorCode: 'timeout',
    }).map((event) => event.id)).toEqual([
      'gateway-failed-fast',
    ])
  })

  it('getGatewayFailures should normalize recent gateway failed traces', () => {
    const service = new DefaultObservatoryService()

    service.record(createGatewayRecord('failure-1', 'gateway.failed', {
      route: {
        slot: 'reasoning',
        providerId: 'slot:reasoning',
        providerType: 'gemini',
        model: 'gemini-1.5-pro',
      },
      finalErrorCode: 'http-503',
      fallbackChain: ['reasoning', 'fast'],
      selectedFallbackSlot: 'fast',
      failedOver: true,
      retryCount: 2,
    }))
    service.record(createGatewayRecord('failure-2', 'gateway.failed', {
      route: {
        slot: 'fast',
        providerId: 'slot:fast',
        providerType: 'openai-compatible',
        model: 'fast-model',
      },
      finalErrorCode: 'timeout',
    }))

    const failures = service.getGatewayFailures(1)

    expect(failures).toHaveLength(1)
    expect(failures[0].event.id).toBe('failure-2')
    expect(failures[0].providerId).toBe('slot:fast')
    expect(failures[0].providerType).toBe('openai-compatible')
    expect(failures[0].slot).toBe('fast')
    expect(failures[0].model).toBe('fast-model')
    expect(failures[0].errorCode).toBe('timeout')
  })

  it('getGatewayAnalytics should aggregate gateway failure and fallback metrics', () => {
    const service = new DefaultObservatoryService()

    service.record(createGatewayRecord('requested-1', 'gateway.requested'))
    service.record(createGatewayRecord('responded-1', 'gateway.responded', {
      route: {
        providerId: 'slot:fast',
      },
    }))
    service.record(createGatewayRecord('failed-1', 'gateway.failed', {
      route: {
        slot: 'reasoning',
        providerId: 'slot:reasoning',
        providerType: 'gemini',
      },
      finalErrorCode: 'http-503',
      failedOver: true,
      selectedFallbackSlot: 'fast',
      attempts: [
        {
          providerId: 'slot:reasoning',
          errorCode: 'http-503',
        },
      ],
    }))
    service.record(createGatewayRecord('failed-2', 'gateway.failed', {
      route: {
        slot: 'reasoning',
        providerId: 'slot:reasoning',
        providerType: 'gemini',
      },
      finalErrorCode: 'circuit-open',
      attempts: [
        {
          providerId: 'slot:reasoning',
          errorCode: 'circuit-open',
        },
      ],
    }))

    const analytics = service.getGatewayAnalytics({ recentFailureLimit: 1 })

    expect(analytics.totalGatewayEvents).toBe(4)
    expect(analytics.requestCount).toBe(1)
    expect(analytics.responseCount).toBe(1)
    expect(analytics.failureCount).toBe(2)
    expect(analytics.failedOverCount).toBe(1)
    expect(analytics.circuitOpenCount).toBe(1)
    expect(analytics.byProviderId).toEqual({
      'slot:fast': 1,
      'slot:reasoning': 2,
    })
    expect(analytics.byErrorCode).toEqual({
      'http-503': 1,
      'circuit-open': 1,
    })
    expect(analytics.byFallbackSlot).toEqual({
      fast: 1,
    })
    expect(analytics.recentFailures).toHaveLength(1)
    expect(analytics.recentFailures[0].event.id).toBe('failed-2')
  })

  it('getGatewayAnalytics should handle empty gateway streams and missing diagnostics', () => {
    const service = new DefaultObservatoryService()

    expect(service.getGatewayAnalytics()).toMatchObject({
      totalGatewayEvents: 0,
      requestCount: 0,
      responseCount: 0,
      failureCount: 0,
      failedOverCount: 0,
      circuitOpenCount: 0,
      byProviderId: {},
      byErrorCode: {},
      byFallbackSlot: {},
      recentFailures: [],
    })

    service.record(createRecord('gateway-without-diagnostics', {
      kind: 'gateway',
      event: 'gateway.failed',
      status: 'failed',
    }))

    const analytics = service.getGatewayAnalytics()

    expect(analytics.totalGatewayEvents).toBe(1)
    expect(analytics.failureCount).toBe(1)
    expect(analytics.byProviderId).toEqual({})
    expect(analytics.byErrorCode).toEqual({})
    expect(analytics.recentFailures[0].event.id).toBe('gateway-without-diagnostics')
    expect(analytics.recentFailures[0].providerId).toBeUndefined()
    expect(analytics.recentFailures[0].errorCode).toBeUndefined()
  })

  it('queryEvents should match providerId and errorCode across all gateway attempts', () => {
    const service = new DefaultObservatoryService()

    service.record(createGatewayRecord('multi-attempt-failure', 'gateway.failed', {
      finalErrorCode: 'timeout',
      attempts: [
        {
          providerId: 'slot:reasoning',
          errorCode: 'http-503',
        },
        {
          providerId: 'slot:fast',
          errorCode: 'timeout',
        },
      ],
    }))

    expect(service.queryEvents({ providerId: 'slot:fast' }).map((event) => event.id)).toEqual([
      'multi-attempt-failure',
    ])
    expect(service.queryEvents({ errorCode: 'http-503' }).map((event) => event.id)).toEqual([
      'multi-attempt-failure',
    ])
    expect(service.queryEvents({ providerId: 'slot:fast', errorCode: 'timeout' }).map((event) => event.id)).toEqual([
      'multi-attempt-failure',
    ])
  })

  it('getSnapshot should include gateway analytics while preserving existing snapshot statistics', () => {
    const service = new DefaultObservatoryService()

    service.record(createRecord('stimulus', {
      kind: 'stimulus',
      event: 'stimulus.received',
      status: 'received',
      stimulusId: 'stimulus-1',
    }))
    service.record(createRecord('dialogue', {
      kind: 'dialogue',
      event: 'dialogue.completed',
      status: 'completed',
      stimulusId: 'stimulus-1',
    }))
    service.record(createGatewayRecord('gateway', 'gateway.responded', {
      route: {
        providerId: 'slot:fast',
      },
    }))
    service.record(createGatewayRecord('failed', 'gateway.failed', {
      route: {
        providerId: 'slot:fast',
      },
      finalErrorCode: 'timeout',
    }))

    const snapshot = service.getSnapshot()

    expect(snapshot.trackedStimulusCount).toBe(1)
    expect(snapshot.activeStimulusCount).toBe(1)
    expect(snapshot.dialogueCount).toBe(1)
    expect(snapshot.gatewayCount).toBe(1)
    expect(snapshot.failureCount).toBe(1)
    expect(snapshot.gatewayAnalytics).toMatchObject({
      totalGatewayEvents: 2,
      responseCount: 1,
      failureCount: 1,
      byProviderId: {
        'slot:fast': 2,
      },
      byErrorCode: {
        timeout: 1,
      },
    })
  })
})
