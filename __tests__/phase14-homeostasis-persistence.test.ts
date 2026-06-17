/**
 * Phase 14 Homeostasis Persistence 集成测试
 *
 * 验证 homeostasis 正式接入 runtime.stateRepository：
 * 1. life.loaded 时无状态则初始化并写入 repository
 * 2. 已有状态时恢复而不是重置
 * 3. perception.completed 后 tick 并写回 repository
 * 4. 多 life 状态互不污染
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  CoreEventMap,
  HomeostasisState,
  PerceptionResult,
} from '../packages/@elysia-ai/core/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'

function createMockKoishiContext(runtime: Runtime) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia-ai-runtime': runtime,

    logger() {
      return {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }
    },

    on(event: string, handler: (...args: any[]) => any) {
      ;(handlers[event] ??= []).push(handler)
      if (event === 'dispose') disposeHandlers.push(handler)
      return () => {
        const list = handlers[event]
        if (!list) return
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },

    dispose() {
      for (const handler of disposeHandlers) handler()
    },
  }

  return ctx
}

function installHomeostasis(ctx: any) {
  homeostasisPlugin.apply(ctx, {
    initialEnergy: 0.8,
    initialMood: 0.6,
    initialSociability: 0.5,
    initialCuriosity: 0.7,
    energyDecayPerTick: 0.01,
    moodDecayPerTick: 0.005,
    sociabilityDecayPerTick: 0.003,
    curiosityDecayPerTick: 0.002,
    maxValue: 1,
    minValue: 0,
    responseThresholdMin: 0.3,
    responseThresholdMax: 0.8,
    restoreOnStartup: true,
  })
}

function createPerceptionResult(stimulusId: string): PerceptionResult {
  return {
    stimulusId,
    context: {
      stimulusId,
      habitatId: 'habitat-phase14',
      actorId: 'user-phase14',
      type: 'utterance',
      tokenCount: 4,
    },
    intent: {
      primary: 'statement',
      confidence: 0.4,
    },
    entities: [],
    sentiment: {
      label: 'neutral',
      confidence: 0.5,
    },
    analyzedAt: Date.now(),
  }
}

function createPersistedState(lifeInstanceId: string): HomeostasisState {
  return {
    lifeInstanceId,
    timestamp: Date.now() - 1000,
    energy: 0.42,
    mood: 0.33,
    sociability: 0.24,
    curiosity: 0.15,
    responseThreshold: 0.66,
    metadata: {
      source: 'phase14-test',
    },
  }
}

describe('Phase 14 Homeostasis Persistence 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('life.loaded 时无状态则初始化并写入 repository', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installHomeostasis(ctx)

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-phase14-init', type: 'elysia-default' }],
    })

    const state = await runtime.stateRepository.getByLifeInstanceId('life-phase14-init')

    expect(state?.lifeInstanceId).toBe('life-phase14-init')
    expect(state?.energy).toBe(0.8)
    expect(state?.mood).toBe(0.6)
    expect(state?.sociability).toBe(0.5)
    expect(state?.curiosity).toBe(0.7)
    expect(typeof state?.responseThreshold).toBe('number')
  })

  it('已有状态时 life.loaded 恢复而不是重置', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const persisted = createPersistedState('life-phase14-restore')
    await runtime.stateRepository.save('life-phase14-restore', persisted)

    ctx = createMockKoishiContext(runtime)
    installHomeostasis(ctx)

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-phase14-restore', type: 'elysia-default' }],
    })

    const restored = await runtime.stateRepository.getByLifeInstanceId('life-phase14-restore')

    expect(restored?.energy).toBe(0.42)
    expect(restored?.mood).toBe(0.33)
    expect(restored?.sociability).toBe(0.24)
    expect(restored?.curiosity).toBe(0.15)
    expect(restored?.metadata?.source).toBe('phase14-test')
  })

  it('perception.completed 后 tick 并写回 repository', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installHomeostasis(ctx)

    const updates: CoreEventMap['homeostasis.updated'][] = []
    runtime.context.eventBus.on('homeostasis.updated', (payload) => {
      updates.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-phase14-tick', type: 'elysia-default' }],
    })

    const before = await runtime.stateRepository.getByLifeInstanceId('life-phase14-tick')
    // D3-1：tick 仅作用于被路由的生命，需先 projection.routed 标记路由。
    await runtime.context.eventBus.emit('projection.routed', {
      stimulusId: 'p14-tick',
      routing: {
        stimulusId: 'p14-tick',
        habitatId: 'habitat-phase14',
        lifeIds: ['life-phase14-tick'],
        projectionIds: [],
        routedAt: Date.now(),
        reason: 'test-route',
      },
    })
    await runtime.context.eventBus.emit('perception.completed', {
      stimulusId: 'p14-tick',
      result: createPerceptionResult('p14-tick'),
    })
    const after = await runtime.stateRepository.getByLifeInstanceId('life-phase14-tick')

    expect(updates).toHaveLength(1)
    expect(after?.lifeInstanceId).toBe('life-phase14-tick')
    expect(after?.timestamp).toBeGreaterThanOrEqual(before?.timestamp ?? 0)
    // D3-1：初始值即基线（baseline 默认取 initial），故在基线处的 energy 不漂移。
    expect(after?.energy).toBeCloseTo(before?.energy ?? 0)
    expect(updates[0].state).toEqual(after)
    expect(updates[0].delta.reason).toBe('stimulus.p14-tick')
  })

  it('多 life 状态互不污染', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installHomeostasis(ctx)

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-phase14-a', type: 'elysia-default' },
        { id: 'life-phase14-b', type: 'elysia-default' },
      ],
    })

    const stateA = await runtime.stateRepository.getByLifeInstanceId('life-phase14-a')
    const stateB = await runtime.stateRepository.getByLifeInstanceId('life-phase14-b')

    expect(stateA?.lifeInstanceId).toBe('life-phase14-a')
    expect(stateB?.lifeInstanceId).toBe('life-phase14-b')
    expect(stateA).not.toBe(stateB)

    await runtime.context.eventBus.emit('projection.routed', {
      stimulusId: 'p14-multi',
      routing: {
        stimulusId: 'p14-multi',
        habitatId: 'habitat-phase14',
        lifeIds: ['life-phase14-a', 'life-phase14-b'],
        projectionIds: [],
        routedAt: Date.now(),
        reason: 'test-route',
      },
    })
    await runtime.context.eventBus.emit('perception.completed', {
      stimulusId: 'p14-multi',
      result: createPerceptionResult('p14-multi'),
    })

    const nextA = await runtime.stateRepository.getByLifeInstanceId('life-phase14-a')
    const nextB = await runtime.stateRepository.getByLifeInstanceId('life-phase14-b')

    expect(nextA?.lifeInstanceId).toBe('life-phase14-a')
    expect(nextB?.lifeInstanceId).toBe('life-phase14-b')
    // D3-1：初始即基线，基线处不漂移；两 life 仍各自独立 tick。
    expect(nextA?.energy).toBeCloseTo(stateA?.energy ?? 0)
    expect(nextB?.energy).toBeCloseTo(stateB?.energy ?? 0)
  })
})
