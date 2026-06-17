/**
 * Phase 13 Projection Rules 集成测试
 *
 * 验证 runtime projection routing 从“全部 active life 感知”升级为：
 * 1. 无规则时保持 fallback 兼容
 * 2. 有规则时按 habitat/channel 等字段精确匹配
 * 3. 命中结果按 priority 排序
 * 4. disabled rule 不生效
 * 5. projection rules 能限制 behavior 主链只进入匹配 life
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
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

function createStimulus(id: string, channelId = 'channel-phase13-a'): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase13',
    actorId: 'user-phase13',
    channelId,
    platform: 'qq',
    botId: 'bot-phase13',
    payload: {
      content: 'hello projection rules',
    },
  }
}

describe('Phase 13 Projection Rules 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('无 projection rules 时保持 fallback：所有 active life 均感知', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const routedEvents: CoreEventMap['projection.routed'][] = []
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-fallback-a', type: 'elysia-default' },
        { id: 'life-fallback-b', type: 'elysia-default' },
      ],
    })

    await runtime.receiveStimulus(createStimulus('p13-fallback'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual(['life-fallback-a', 'life-fallback-b'])
    expect(routedEvents[0].routing.reason).toContain('default resolver')
    expect(routedEvents[0].routing.metadata?.mode).toBe('fallback-all-active-lives')
  })

  it('channelId 精确匹配单个 life', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const routedEvents: CoreEventMap['projection.routed'][] = []
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        {
          id: 'life-channel-a',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-channel-a',
                priority: 100,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-a',
              }],
            },
          },
        },
        {
          id: 'life-channel-b',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-channel-b',
                priority: 100,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-b',
              }],
            },
          },
        },
      ],
    })

    await runtime.receiveStimulus(createStimulus('p13-channel-a', 'channel-phase13-a'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual(['life-channel-a'])
    expect(routedEvents[0].routing.projectionIds).toEqual(['rule-channel-a'])
    expect(routedEvents[0].routing.matchedRules?.[0].id).toBe('rule-channel-a')
  })

  it('多个匹配 rule 按 priority 从高到低排序', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const routedEvents: CoreEventMap['projection.routed'][] = []
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        {
          id: 'life-priority-low',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-priority-low',
                priority: 10,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-a',
              }],
            },
          },
        },
        {
          id: 'life-priority-high',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-priority-high',
                priority: 100,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-a',
              }],
            },
          },
        },
      ],
    })

    await runtime.receiveStimulus(createStimulus('p13-priority', 'channel-phase13-a'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual(['life-priority-high', 'life-priority-low'])
    expect(routedEvents[0].routing.projectionIds).toEqual(['rule-priority-high', 'rule-priority-low'])
  })

  it('存在 rules 但 disabled 时不 fallback 到全部 life', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const routedEvents: CoreEventMap['projection.routed'][] = []
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-disabled-rule',
        type: 'elysia-default',
        extensions: {
          projection: {
            rules: [{
              id: 'rule-disabled',
              enabled: false,
              priority: 100,
              habitatId: 'habitat-phase13',
              channelId: 'channel-phase13-a',
            }],
          },
        },
      }],
    })

    await runtime.receiveStimulus(createStimulus('p13-disabled', 'channel-phase13-a'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual([])
    expect(routedEvents[0].routing.reason).toBe('no projection rule matched')
    expect(routedEvents[0].routing.metadata?.mode).toBe('projection-rules')
  })

  it('projection rules 限制 behavior 主链只进入匹配 life', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    const instructionEvents: CoreEventMap['behavior.instruction'][] = []

    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructionEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        {
          id: 'life-behavior-matched',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-behavior-matched',
                priority: 100,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-a',
              }],
            },
          },
        },
        {
          id: 'life-behavior-ignored',
          type: 'elysia-default',
          extensions: {
            projection: {
              rules: [{
                id: 'rule-behavior-ignored',
                priority: 100,
                habitatId: 'habitat-phase13',
                channelId: 'channel-phase13-b',
              }],
            },
          },
        },
      ],
    })

    await runtime.receiveStimulus(createStimulus('p13-behavior', 'channel-phase13-a'))

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].lifeId).toBe('life-behavior-matched')

    expect(instructionEvents).toHaveLength(1)
    expect(instructionEvents[0].instruction.lifeId).toBe('life-behavior-matched')
  })
})
