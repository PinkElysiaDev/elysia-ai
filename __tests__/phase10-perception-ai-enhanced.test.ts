/**
 * Phase 10 Perception AI Enhanced 集成测试
 *
 * 验证 perception AI enhanced 可选路径：
 * 1. 默认规则路径不调用 brain
 * 2. AI enhanced 成功时合并 intent / entities / sentiment
 * 3. AI enhanced 失败时 fallback 到 rule-based
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  BrainService,
  PerceptionResult,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import * as perceptionPlugin from '../packages/elysia-ai-perception/src/index.js'

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

function createPerceptionConfig(
  overrides: Partial<perceptionPlugin.Config> = {},
): perceptionPlugin.Config {
  return {
    maxInputTokens: 8192,
    enabledIntentClassify: true,
    enabledEntityExtract: true,
    enabledSentiment: true,
    aiEnhanced: false,
    aiFallbackToRuleBased: true,
    aiMinTextLength: 12,
    aiModelSlot: '',
    ...overrides,
  }
}

function createStimulus(id: string, content: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase10',
    actorId: 'user-phase10',
    channelId: 'channel-phase10',
    payload: { content },
  }
}

describe('Phase 10 Perception AI Enhanced 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
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
    perceptionPlugin.apply(ctx, createPerceptionConfig({ aiEnhanced: false }))

    const results: PerceptionResult[] = []
    runtime.context.eventBus.on('perception.completed', ({ result }) => {
      results.push(result)
    })

    await runtime.receiveStimulus(createStimulus('p10-rule-1', '你好，请问现在几点？'))

    expect(brain.execute).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('rule-based')
    expect(results[0].metadata?.aiRequested).toBe(false)
  })

  it('AI enhanced 成功时合并 intent / entities / sentiment', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const brain: BrainService = {
      execute: vi.fn(async () => ({
        output: JSON.stringify({
          intent: { primary: 'ask_support', confidence: 0.92 },
          entities: [
            { type: 'topic', value: '今天发生的事情', confidence: 0.88 },
          ],
          sentiment: { label: 'negative', confidence: 0.86 },
        }),
        metadata: {
          provider: { id: 'mock-provider', type: 'test' },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })),
    }

    ctx = createMockKoishiContext(runtime, brain)
    perceptionPlugin.apply(ctx, createPerceptionConfig({ aiEnhanced: true }))

    const results: PerceptionResult[] = []
    runtime.context.eventBus.on('perception.completed', ({ result }) => {
      results.push(result)
    })

    await runtime.receiveStimulus(createStimulus(
      'p10-ai-1',
      '我今天发生了很糟糕的事情，想找你聊聊。',
    ))

    expect(brain.execute).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0].intent.primary).toBe('ask_support')
    expect(results[0].sentiment.label).toBe('negative')
    expect(results[0].entities).toContainEqual({
      type: 'topic',
      value: '今天发生的事情',
      confidence: 0.88,
    })
    expect(results[0].metadata?.mode).toBe('ai-enhanced')
    expect(results[0].metadata?.aiRequested).toBe(true)
    expect(results[0].metadata?.aiSucceeded).toBe(true)
  })

  it('AI enhanced 失败时 fallback 到 rule-based', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const brain: BrainService = {
      execute: vi.fn(async () => {
        throw new Error('mock ai perception failure')
      }),
    }

    ctx = createMockKoishiContext(runtime, brain)
    perceptionPlugin.apply(ctx, createPerceptionConfig({
      aiEnhanced: true,
      aiFallbackToRuleBased: true,
    }))

    const results: PerceptionResult[] = []
    runtime.context.eventBus.on('perception.completed', ({ result }) => {
      results.push(result)
    })

    await runtime.receiveStimulus(createStimulus(
      'p10-fallback-1',
      '我今天想和你聊聊一个复杂的问题。',
    ))

    expect(brain.execute).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0].metadata?.mode).toBe('fallback-rule-based')
    expect(results[0].metadata?.aiRequested).toBe(true)
    expect(results[0].metadata?.aiSucceeded).toBe(false)
    expect(String(results[0].metadata?.errorSummary)).toContain('mock ai perception failure')
  })
})
