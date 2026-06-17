/**
 * Phase 9 Persona Behavior Integration 集成测试
 *
 * 验证 persona traits 正式进入 behavior planning：
 * 1. 带温柔/好奇 traits 的 life 会提高 responseNecessity
 * 2. 好奇 trait 会降低 structuralDeterminability，使行为更倾向进入 AI 规划路径
 * 3. 活泼 / 沉稳 traits 会按预期调整 directness
 * 4. 无 persona 时保持原始 signal 倾向
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  CoreEventMap,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
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

function installBehaviorPipeline(ctx: any) {
  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
  })
}

function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase9-persona',
    actorId: 'user-phase9-persona',
    channelId: 'channel-phase9-persona',
    payload: {
      content: '你好，我想和你聊聊今天发生的事情',
    },
  }
}

describe('Phase 9 Persona Behavior Integration 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('温柔/好奇 traits 会调整 behavior signal 并推动进入 send-to-ai', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-persona-curious',
        type: 'elysia-default',
        extensions: {
          persona: {
            name: 'Elysia',
            systemPrompt: '你是 Elysia，一个温柔且好奇的虚拟生命体。',
            traits: ['温柔', '好奇'],
            tone: '温柔、自然',
          },
        },
      }],
    })

    await runtime.receiveStimulus(createStimulus('p9-persona-behavior-1'))

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].lifeId).toBe('life-persona-curious')
    expect(selectedEvents[0].signal.responseNecessity).toBeGreaterThanOrEqual(60)
    expect(selectedEvents[0].signal.structuralDeterminability).toBeLessThan(50)
    expect(selectedEvents[0].decision).toBe('send-to-ai')
    expect(selectedEvents[0].plan.shouldEnterDialogue).toBe(true)
  })

  it('活泼 trait 会提高 directness 与 responseNecessity', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-persona-outgoing',
        type: 'elysia-default',
        extensions: {
          persona: {
            name: 'Outgoing Elysia',
            systemPrompt: '你是一个活泼开朗的虚拟生命体。',
            traits: ['活泼'],
          },
        },
      }],
    })

    await runtime.receiveStimulus(createStimulus('p9-persona-behavior-outgoing'))

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].signal.directness).toBe(76)
    expect(selectedEvents[0].signal.responseNecessity).toBe(55)
  })

  it('沉稳 trait 会降低 directness 并提高 structuralDeterminability', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-persona-calm',
        type: 'elysia-default',
        extensions: {
          persona: {
            name: 'Calm Elysia',
            systemPrompt: '你是一个沉稳内敛的虚拟生命体。',
            traits: ['沉稳'],
          },
        },
      }],
    })

    await runtime.receiveStimulus(createStimulus('p9-persona-behavior-calm'))

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].signal.directness).toBe(66)
    expect(selectedEvents[0].signal.structuralDeterminability).toBe(54)
  })

  it('无 persona 时保持原始 behavior signal 倾向', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-persona-none',
        type: 'elysia-default',
      }],
    })

    await runtime.receiveStimulus(createStimulus('p9-persona-behavior-none'))

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].signal.directness).toBe(70)
    expect(selectedEvents[0].signal.responseNecessity).toBe(50)
    expect(selectedEvents[0].signal.structuralDeterminability).toBe(50)
  })
})
