/**
 * Phase 11 Cognition Enhanced 集成测试
 *
 * 验证 cognition 规则改进与 AI enhanced 路径：
 * 1. 规则版消费 perception 结果提升 salience
 * 2. 规则版消费 homeostasis 状态调整 salience
 * 3. 规则版 reason 包含可解释信号
 * 4. AI enhanced 成功时加权合并 salience/continuity
 * 5. AI enhanced 失败时 fallback 到 rule-based
 * 6. 默认规则路径不调用 brain
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  BrainService,
  CognitionResult,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import * as perceptionPlugin from '../packages/elysia-ai-perception/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'

function createMockKoishiContext(runtime: Runtime, brain?: BrainService) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia-ai-runtime': runtime,
    'elysia-ai-brain': brain,

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

function createCognitionConfig(
  overrides: Partial<cognitionPlugin.Config> = {},
): cognitionPlugin.Config {
  return {
    recentConversationLimit: 12,
    salienceDirectMentionBonus: 0.35,
    salienceDirectMessageBonus: 0.25,
    salienceReplyBonus: 0.2,
    salienceQuestionBonus: 0.15,
    salienceLengthFactor: 0.001,
    behaviorThreshold: 0.35,
    aiEnhanced: false,
    aiFallbackToRuleBased: true,
    aiMinSalience: 0.2,
    aiModelSlot: '',
    ...overrides,
  }
}

function installPerceptionAndHomeostasis(ctx: any) {
  perceptionPlugin.apply(ctx, {
    maxInputTokens: 8192,
    enabledIntentClassify: true,
    enabledEntityExtract: true,
    enabledSentiment: true,
    aiEnhanced: false,
    aiFallbackToRuleBased: true,
    aiMinTextLength: 12,
    aiModelSlot: '',
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
    restoreOnStartup: false,
  })
}

function createStimulus(id: string, overrides: Partial<Stimulus> = {}): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase11',
    actorId: 'user-phase11',
    channelId: 'channel-phase11',
    payload: { content: '你好，我想和你聊聊' },
    ...overrides,
  }
}

describe('Phase 11 Cognition Enhanced 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  // ─────────────────────────────────────────────────
  // 规则改进测试
  // ─────────────────────────────────────────────────

  it('消费 perception 结果：负面情感 stimulus 提升 salience', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig())

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-perception-test', type: 'elysia-default' }],
    })

    // 负面情感消息（使用 perception 规则能识别的关键词）
    await runtime.receiveStimulus(createStimulus('p11-negative-1', {
      payload: { content: '我今天真的很 sad，心情 terrible 透了，讨厌一切' },
    }))

    expect(results).toHaveLength(1)
    expect(results[0].metadata?.perceptionSentiment).toBe('negative')
    // 负面情感 +0.10，加上基础 salience（utterance 无 @mention 基线约 0.13）
    // 总 salience 约 0.23，验证 perception 确实提升了 salience
    expect(results[0].salience).toBeGreaterThan(0.2)
    expect(results[0].reason).toContain('negative sentiment')
  })

  it('消费 perception 结果：share_feeling intent 提升 salience', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig())

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-feeling-test', type: 'elysia-default' }],
    })

    // 使用 perception 规则能识别的 share_feeling 模式
    await runtime.receiveStimulus(createStimulus('p11-feeling-1', {
      payload: { content: 'i feel so happy today, 想和你分享这份快乐' },
    }))

    expect(results).toHaveLength(1)
    expect(results[0].metadata?.perceptionIntent).toBe('share_feeling')
    // share_feeling +0.12，加上基础 salience（utterance 无 @mention 基线约 0.14）
    // 总 salience 约 0.29，验证 perception 确实提升了 salience
    expect(results[0].salience).toBeGreaterThan(0.25)
    expect(results[0].reason).toContain('user sharing feelings')
  })

  it('消费 homeostasis 状态：metadata 包含 homeostasis 信息', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig())

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-homeostasis-test', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-homeo-1'))

    expect(results).toHaveLength(1)
    // homeostasis 已通过 life.loaded → homeostasis.updated 初始化
    expect(results[0].metadata?.homeostasisEnergy).toBeDefined()
    expect(typeof results[0].metadata?.homeostasisEnergy).toBe('number')
  })

  it('reason 包含可解释信号：@mention + question', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig())

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-reason-test', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-reason-1', {
      type: 'addressing',
      isMentioned: true,
      payload: { content: '@Elysia 你觉得我应该怎么做？' },
    }))

    expect(results).toHaveLength(1)
    expect(results[0].shouldEnterBehavior).toBe(true)
    expect(results[0].reason).toContain('directly mentioned')
    expect(results[0].reason).toContain('addressing type')
  })

  it('metadata.mode 为 rule-based 且 aiRequested 为 false', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig({ aiEnhanced: false }))

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-mode-test', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-mode-1'))

    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('rule-based')
    expect(results[0].metadata?.aiRequested).toBe(false)
  })

  // ─────────────────────────────────────────────────
  // AI Enhanced 测试
  // ─────────────────────────────────────────────────

  it('AI enhanced 成功时加权合并 salience/continuity', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const brain: BrainService = {
      execute: vi.fn(async () => ({
        output: JSON.stringify({
          summary: '用户表达情绪压力，需要关注',
          salience: 0.95,
          continuity: 0.8,
          shouldEnterBehavior: true,
          reason: 'user expressing emotional distress',
        }),
        metadata: {
          provider: { id: 'mock-provider' },
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        },
      })),
    }

    ctx = createMockKoishiContext(runtime, brain)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig({ aiEnhanced: true }))

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-ai-test', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-ai-1', {
      type: 'addressing',
      isMentioned: true,
      payload: { content: '我真的撑不住了，能和你聊聊吗？' },
    }))

    expect(brain.execute).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('ai-enhanced')
    expect(results[0].metadata?.aiRequested).toBe(true)
    expect(results[0].metadata?.aiSucceeded).toBe(true)
    expect(results[0].summary).toBe('用户表达情绪压力，需要关注')
    expect(results[0].reason).toContain('ai:')
    expect(results[0].shouldEnterBehavior).toBe(true)
    // 加权合并：rule * 0.6 + ai * 0.4，AI salience 0.95 会拉高最终值
    expect(results[0].salience).toBeGreaterThan(0.5)
  })

  it('AI enhanced 失败时 fallback 到 rule-based', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const brain: BrainService = {
      execute: vi.fn(async () => {
        throw new Error('mock cognition ai failure')
      }),
    }

    ctx = createMockKoishiContext(runtime, brain)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig({
      aiEnhanced: true,
      aiFallbackToRuleBased: true,
    }))

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-ai-fallback', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-ai-fallback-1', {
      type: 'addressing',
      isMentioned: true,
      payload: { content: '你好，我想问你一个问题？' },
    }))

    expect(brain.execute).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('fallback-rule-based')
    expect(results[0].metadata?.aiRequested).toBe(true)
    expect(results[0].metadata?.aiSucceeded).toBe(false)
    expect(String(results[0].metadata?.errorSummary)).toContain('mock cognition ai failure')
    // fallback 后仍然有合理的 salience（来自规则版）
    expect(results[0].salience).toBeGreaterThan(0)
  })

  it('默认规则路径不调用 brain', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const brain: BrainService = {
      execute: vi.fn(async () => {
        throw new Error('brain should not be called')
      }),
    }

    ctx = createMockKoishiContext(runtime, brain)
    installPerceptionAndHomeostasis(ctx)
    cognitionPlugin.apply(ctx, createCognitionConfig({ aiEnhanced: false }))

    const results: CognitionResult[] = []
    runtime.context.eventBus.on('cognition.completed', (result) => {
      results.push(result)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-no-ai', type: 'elysia-default' }],
    })

    await runtime.receiveStimulus(createStimulus('p11-no-ai-1', {
      type: 'addressing',
      isMentioned: true,
      payload: { content: '你好，这是一条普通消息' },
    }))

    expect(brain.execute).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('rule-based')
  })
})
