/**
 * Phase 5 Observatory Trace 集成测试
 *
 * 验证 observatory 作为旁路观察者接入主链：
 * 1. 记录完整 message → body.message.sent 主链 trace
 * 2. 记录 gateway / brain / dialogue 失败链路
 * 3. recent events 遵守 maxRecords 上限
 * 4. payload sanitize 不应导致 observatory 崩溃
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import * as observatoryPlugin from '../packages/elysia-ai-observatory/src/index.js'
import * as gatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as bodyPlugin from '../packages/elysia-ai-body/src/index.js'

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

      if (event === 'dispose') {
        disposeHandlers.push(handler)
      }

      return () => {
        const list = handlers[event]
        if (!list) return
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },

    async receiveMessage(session: any) {
      for (const handler of handlers.message ?? []) {
        await handler(session)
      }
    },

    dispose() {
      for (const handler of disposeHandlers) {
        handler()
      }
    },
  }

  return ctx
}

async function createStartedRuntime() {
  const runtime = createDefaultRuntime()
  await runtime.start()
  await runtime.loadManifest({
    version: '1.0',
    lifeInstances: [{ id: 'life-phase5', type: 'elysia-default' }],
  })
  return runtime
}

async function installPipeline(ctx: any, observatoryConfig: { maxRecords?: number } = {}) {
  observatoryPlugin.apply(ctx, {
    enabled: true,
    maxRecords: observatoryConfig.maxRecords ?? 500,
  })

  gatewayPlugin.apply(ctx, {
    slots: {
      default: {
        type: 'openai-compatible',
        apiKey: 'test-key',
        model: 'dialogue-generation',
      },
    },
    defaultSlot: 'default',
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
  })

  brainPlugin.apply(ctx, {
    systemPrompt: '你是 Elysia Phase 5 测试助手',
    contextWindow: 10,
  })

  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
  })

  dialoguePlugin.apply(ctx, {
    enabled: true,
  })

  bodyPlugin.apply(ctx, {})
}

function installMockProvider(ctx: any, output = 'Elysia phase 5 reply') {
  const gateway = ctx['elysia-ai-model-gateway']
  const provider = gateway.getRegistry().resolveSlot('default')

  provider.execute = vi.fn(async (request: any) => ({
    output,
    messages: [
      ...request.messages,
      { role: 'assistant' as const, content: output },
    ],
    provider: {
      id: 'slot:default',
      type: 'openai-compatible' as const,
      model: 'dialogue-generation',
    },
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    finishReason: 'stop',
    metadata: {
      source: 'phase5-test',
    },
  }))

  return provider
}

describe('Phase 5 Observatory Trace 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  beforeEach(async () => {
    runtime = await createStartedRuntime()
    ctx = createMockKoishiContext(runtime)
  })

  afterEach(async () => {
    ctx.dispose()
    if (runtime.getState() === 'running') {
      await runtime.stop()
    }
  })

  it('应按 stimulusId 聚合完整主链 trace', async () => {
    await installPipeline(ctx)
    installMockProvider(ctx)
    const send = vi.fn()

    await ctx.receiveMessage({
      messageId: 'phase5-stimulus-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-1',
      userId: 'user-1',
      content: '你好，Observatory',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('phase5-stimulus-1')
    const events = trace?.events.map((event: any) => event.event) ?? []

    expect(events).toContain('stimulus.received')
    expect(events).toContain('behavior.instruction')
    expect(events).toContain('dialogue.task.created')
    expect(events).toContain('dialogue.generation.requested')
    expect(events).toContain('brain.requested')
    expect(events).toContain('gateway.requested')
    expect(events).toContain('dialogue.output.created')
    expect(events).toContain('sender.completed')
    expect(events).toContain('body.message.sent')

    const output = trace?.events.find((event: any) => event.event === 'dialogue.output.created')
    expect(output?.outputId).toBeDefined()
    expect(output?.summary).toContain('dialogue.output.created')
  })

  it('gateway 失败时应记录 gateway / brain / dialogue 失败 trace 且不记录发送成功', async () => {
    await installPipeline(ctx)

    const gateway = ctx['elysia-ai-model-gateway']
    const provider = gateway.getRegistry().resolveSlot('default')
    provider.execute = vi.fn(async () => {
      throw new Error('phase5 gateway failure')
    })

    const send = vi.fn()

    await ctx.receiveMessage({
      messageId: 'phase5-stimulus-2',
      id: 'session-2',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-2',
      userId: 'user-2',
      content: '触发失败 trace',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('phase5-stimulus-2')
    const events = trace?.events.map((event: any) => event.event) ?? []

    expect(events).toContain('gateway.failed')
    expect(events).toContain('brain.failed')
    expect(events).toContain('dialogue.failed')
    expect(events).not.toContain('dialogue.output.created')
    expect(events).not.toContain('body.message.sent')
    expect(send).not.toHaveBeenCalled()
  })

  it('recent events 应遵守 maxRecords 上限', async () => {
    await installPipeline(ctx, { maxRecords: 3 })

    await runtime.context.eventBus.emit('runtime.starting', { timestamp: 1 })
    await runtime.context.eventBus.emit('runtime.started', { timestamp: 2 })
    await runtime.context.eventBus.emit('runtime.stopping', { timestamp: 3 })
    await runtime.context.eventBus.emit('runtime.stopped', { timestamp: 4 })

    const recent = ctx['elysia-ai-observatory'].service.getRecentEvents(10)

    expect(recent).toHaveLength(3)
    expect(recent.map((event: any) => event.event)).toEqual([
      'runtime.started',
      'runtime.stopping',
      'runtime.stopped',
    ])
  })

  it('payload sanitize 不应因 Error / function / 循环引用崩溃', async () => {
    observatoryPlugin.apply(ctx, {
      enabled: true,
      maxRecords: 20,
    })

    const circular: any = {
      fn: () => 'ignored',
      error: new Error('sanitize error'),
    }
    circular.self = circular

    await (runtime.context.eventBus as any).emit('gateway.failed', {
      request: {
        task: 'sanitize-test',
        messages: [],
        metadata: {
          sourceStimulusIds: ['phase5-sanitize'],
        },
      },
      error: circular,
    })

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('phase5-sanitize')
    const event = trace?.events[0]

    expect(event?.event).toBe('gateway.failed')
    expect(event?.metadata).toBeDefined()
    expect(JSON.stringify(event?.metadata)).toContain('[Circular]')
    expect(JSON.stringify(event?.metadata)).toContain('[Function]')
  })
})
