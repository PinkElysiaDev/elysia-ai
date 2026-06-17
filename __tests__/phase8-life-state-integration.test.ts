/**
 * Phase 8 Life State Integration 集成测试
 *
 * 验证生命状态层正式接入主链：
 * 1. perception.completed 发出完整 PerceptionResult
 * 2. homeostasis.updated 发出 state / delta
 * 3. cognition 基于 projection.routed 按 life 独立推理
 * 4. cognition gate 可以阻止低显著性 stimulus 进入 behavior
 * 5. 高显著性 stimulus 可以正常产生 behavior.instruction
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  CognitionResult,
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
    responseThresholdMin: 0.3,
    responseThresholdMax: 0.8,
  })

  // cognition 必须早于 behavior 注册 projection.routed 监听，
  // 以保证同一轮 projection 中 cognition.completed 先进入 behavior 缓存。
  cognitionPlugin.apply(ctx, {
    recentConversationLimit: 12,
    salienceDirectMentionBonus: 0.35,
    salienceDirectMessageBonus: 0.25,
    salienceReplyBonus: 0.2,
    salienceQuestionBonus: 0.15,
    salienceLengthFactor: 0.001,
    behaviorThreshold: 0.35,
  })

  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
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

    const updates: Array<{ state: HomeostasisState; delta: HomeostasisDelta }> = []
    runtime.context.eventBus.on('homeostasis.updated', ({ state, delta }) => {
      updates.push({ state, delta })
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-homeostasis', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p8-homeostasis-1'))

    expect(updates).toHaveLength(1)
    expect(updates[0].state.lifeInstanceId).toBe('life-homeostasis')
    expect(typeof updates[0].state.energy).toBe('number')
    expect(typeof updates[0].state.responseThreshold).toBe('number')
    expect(updates[0].delta.lifeInstanceId).toBe('life-homeostasis')
    expect(typeof updates[0].delta.energy).toBe('number')
  })

  it('cognition 基于 projection.routed 按 life 独立推理', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
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
  })

  it('cognition gate 阻止低显著性 stimulus 进入 behavior', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const cognitionResults: CognitionResult[] = []
    const instructions: CoreEventMap['behavior.instruction'][] = []

    runtime.context.eventBus.on('cognition.completed', (result) => {
      cognitionResults.push(result)
    })
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-low-salience', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p8-low-salience-1', {
      type: 'silence',
      payload: {},
    }))

    expect(cognitionResults).toHaveLength(1)
    expect(cognitionResults[0].shouldEnterBehavior).toBe(false)
    expect(instructions).toHaveLength(0)
  })

  it('高显著性 stimulus 可以正常产生 behavior.instruction', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installLifeStatePipeline(ctx)

    const cognitionResults: CognitionResult[] = []
    const instructions: CoreEventMap['behavior.instruction'][] = []

    runtime.context.eventBus.on('cognition.completed', (result) => {
      cognitionResults.push(result)
    })
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-high-salience', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p8-high-salience-1', {
      type: 'addressing',
      isMentioned: true,
      isDirectMessage: true,
      payload: { content: '@Elysia 你觉得我现在应该怎么做？' },
    }))

    expect(cognitionResults).toHaveLength(1)
    expect(cognitionResults[0].shouldEnterBehavior).toBe(true)
    expect(instructions).toHaveLength(1)
    expect(instructions[0].instruction.lifeId).toBe('life-high-salience')
    expect(instructions[0].instruction.stimulusId).toBe('p8-high-salience-1')
  })
})
