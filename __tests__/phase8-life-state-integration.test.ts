/**
 * Phase 8 Life State Integration 集成测试
 *
 * 验证生命状态层接入主链：
 * 1. perception.completed 发出完整 PerceptionResult
 * 2. homeostasis.updated 发出 state / delta（事件驱动的状态更新）
 * 3. cognition（事件注入层）基于 projection.routed 按 life 独立入账事件
 *
 * （旧"homeostasis → behavior 信号调制 / cognition 显著性闸门"用例已随
 * 触发器重构删除：普通刺激只进事件历史与密度合并器。）
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  CoreEventMap,
  HomeostasisDelta,
  HomeostasisState,
  PerceptionResult,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import * as perceptionPlugin from '../packages/elysia-ai-perception/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'

function createMockKoishiContext(runtime: Runtime) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia.runtime': runtime,

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

  return asCordisContext(ctx)
}

function installLifeStatePipeline(ctx: any) {
  perceptionPlugin.apply(ctx, {
    maxInputTokens: 8192,
    enabledIntentClassify: true,
    enabledEntityExtract: true,
    enabledSentiment: true,
  })

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
  })

  // cognition（事件注入层）先于 behavior 注册：behavior 依赖 elysia.cognition 服务。
  cognitionPlugin.apply(ctx, {
    events: {
      enabled: true,
      feed: { maxEvents: 30 },
      history: { maxEvents: 100, windowMs: 30 * 60_000 },
    },
  })

  behaviorPlugin.apply(ctx, {
    enableReply: true,
    batcher: {
      quietWindowMs: 8_000,
      dmQuietWindowMs: 1_500,
      maxWaitMs: 30_000,
      densityWindowMs: 10_000,
      densityThreshold: 15,
      maxBatch: 50,
    },
    packMemory: { maxPacks: 12, injectPacks: 2 },
  })
}

function createStimulus(
  id: string,
  overrides: Partial<Stimulus> = {},
): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase8',
    actorId: 'user-phase8',
    channelId: 'channel-phase8',
    payload: {
      content: 'hello phase8',
    },
    ...overrides,
  }
}

describe('Phase 8 Life State Integration 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('perception.completed 发出完整 PerceptionResult', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const results: PerceptionResult[] = []
    runtime.context.eventBus.on('perception.completed', ({ result }) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-perception', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p8-perception-1', {
      payload: { content: '你好，请告诉我现在几点？' },
    }))

    expect(results).toHaveLength(1)
    expect(results[0].stimulusId).toBe('p8-perception-1')
    expect(results[0].context.stimulusId).toBe('p8-perception-1')
    expect(results[0].intent.primary).toBeTruthy()
    expect(results[0].sentiment.label).toMatch(/positive|negative|neutral/)
    expect(Array.isArray(results[0].entities)).toBe(true)
  })

  it('homeostasis.updated 发出 state 与 delta', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const updates: Array<{ lifeInstanceId?: string; state: HomeostasisState; delta: HomeostasisDelta }> = []
    runtime.context.eventBus.on('homeostasis.updated', ({ lifeInstanceId, state, delta }) => {
      updates.push({ lifeInstanceId, state, delta })
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-homeostasis', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p8-homeostasis-1'))

    expect(updates).toHaveLength(1)
    expect(updates[0].lifeInstanceId).toBe('life-homeostasis')
    expect(typeof updates[0].state.energy).toBe('number')
    expect(typeof updates[0].delta.energy).toBe('number')
  })

  it('cognition 基于 projection.routed 按 life 独立入账事件', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const results: CoreEventMap['cognition.event.recorded'][] = []
    runtime.context.eventBus.on('cognition.event.recorded', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-cognition-a', type: 'elysia-default' },
        { id: 'life-cognition-b', type: 'elysia-default' },
      ],
    })

    await runtime.receiveStimulus(createStimulus('p8-cognition-1', {
      type: 'addressing',
      isMentioned: true,
      payload: { content: '@Elysia 你怎么看这个问题？' },
    }))

    expect(results).toHaveLength(2)
    expect(results.map((result) => result.lifeId)).toContain('life-cognition-a')
    expect(results.map((result) => result.lifeId)).toContain('life-cognition-b')
    expect(results.every((result) => result.stimulusId === 'p8-cognition-1')).toBe(true)
    // addressing 刺激派生为 mention 目录事件
    expect(results.every((result) => result.event.key === 'mention')).toBe(true)
  })
})
