/**
 * Phase 5 Observatory Trace 集成测试
 *
 * 验证 observatory 作为旁路观察者接入主链：
 * 1. 记录完整 message → cognition → 触发唤醒 → dialogue 主链 trace
 * 2. 记录 gateway / brain / dialogue 失败链路
 * 3. recent events 遵守 maxRecords 上限
 * 4. payload sanitize 不应导致 observatory 崩溃
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import * as observatoryPlugin from '../packages/elysia-ai-observatory/src/index.js'
import * as gatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as bodyPlugin from '../packages/elysia-ai-body/src/index.js'

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

  return asCordisContext(ctx)
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
    providers: {
      default: {
        type: 'chat-completions',
        baseURL: 'https://gateway.test',
        apiKey: 'test-key',
      },
    },
    providerSlots: {
      default: {
        provider: 'default',
        model: 'dialogue-generation',
      },
    },
    defaultSlot: 'default',
    maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1,
  })

  brainPlugin.apply(ctx, {
    systemPrompt: '你是 Elysia Phase 5 测试助手',
    contextWindow: 10,
  })

  // cognition（事件注入层）先于 behavior 注册。
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
      // 单批 1 条即触发：消息到达后立即点火唤醒
      maxBatch: 1,
    },
    packMemory: { maxPacks: 12, injectPacks: 2 },
  })

  dialoguePlugin.apply(ctx, {
    enabled: true,
  })

  bodyPlugin.apply(ctx, {})
}

/**
 * 唤醒协议 mock provider：第 1 轮 send_reply 工具调用，第 2 轮纯文本收尾。
 */
function installMockProvider(ctx: any, output = 'Elysia phase 5 reply') {
  const gateway = ctx['elysia.modelGateway']
  const provider = gateway.getRegistry().resolveSlot('default')
  let round = 0

  provider.execute = vi.fn(async (request: any) => {
    round++
    if (round === 1) {
      const toolCalls = [{
        id: 'call-send-1',
        type: 'function' as const,
        name: 'send_reply',
        arguments: { text: output },
      }]
      return {
        output: '',
        toolCalls,
        messages: [...request.messages, { role: 'assistant' as const, content: '', toolCalls }],
        provider: {
          id: 'slot:default',
          type: 'chat-completions' as const,
          model: 'dialogue-generation',
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'tool-calls',
        metadata: { source: 'phase5-test' },
      }
    }
    return {
      output: 'done',
      messages: [...request.messages, { role: 'assistant' as const, content: 'done' }],
      provider: {
        id: 'slot:default',
        type: 'chat-completions' as const,
        model: 'dialogue-generation',
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      metadata: { source: 'phase5-test' },
    }
  })

  return provider
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
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

    const triggerFired: Array<{ stimulusId: string }> = []
    runtime.context.eventBus.on('behavior.trigger.fired', (payload) => {
      triggerFired.push(payload)
    })

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

    // 触发唤醒的合成刺激经同 habitat 队列异步处理，等待唤醒链完成。
    await waitFor(() => triggerFired.length >= 1)
    const wakeStimulusId = triggerFired[0].stimulusId
    const observatory = ctx['elysia.observatory'].service
    await waitFor(() => {
      const wakeTrace = observatory.getStimulusTrace(wakeStimulusId)
      return Boolean(wakeTrace?.events.some((event: any) => event.event === 'dialogue.completed'))
    })

    // 原始消息的 trace：入站 + 投影 + 事件入账。
    // （behavior.trigger.fired 的 stimulusId 是合成触发刺激 id，落在唤醒 trace 上。）
    const sourceTrace = observatory.getStimulusTrace('phase5-stimulus-1')
    const sourceEvents = sourceTrace?.events.map((event: any) => event.event) ?? []
    expect(sourceEvents).toContain('stimulus.received')
    expect(sourceEvents).toContain('projection.routed')
    expect(sourceEvents).toContain('cognition.event.recorded')

    // 合成触发刺激的 trace：点火 → 唤醒 → 指令 → 对话（agentic）全链。
    const trace = observatory.getStimulusTrace(wakeStimulusId)
    const events = trace?.events.map((event: any) => event.event) ?? []

    expect(events).toContain('stimulus.received')
    expect(events).toContain('behavior.trigger.fired')
    expect(events).toContain('behavior.instruction')
    expect(events).toContain('dialogue.task.created')
    expect(events).toContain('dialogue.generation.requested')
    expect(events).toContain('brain.requested')
    expect(events).toContain('gateway.requested')
    expect(events).toContain('dialogue.output.created')

    const output = trace?.events.find((event: any) => event.event === 'dialogue.output.created')
    expect(output?.outputId).toBeDefined()
    expect(output?.summary).toContain('dialogue.output.created')
  })

  it('gateway 失败时应记录 gateway / brain / dialogue 失败 trace 且不记录发送成功', async () => {
    await installPipeline(ctx)

    const gateway = ctx['elysia.modelGateway']
    const provider = gateway.getRegistry().resolveSlot('default')
    provider.execute = vi.fn(async () => {
      throw new Error('phase5 gateway failure')
    })

    const send = vi.fn()

    const triggerFired: Array<{ stimulusId: string }> = []
    const dialogueFailed: Array<{ task: { sourceStimulusIds: string[] } }> = []
    runtime.context.eventBus.on('behavior.trigger.fired', (payload) => {
      triggerFired.push(payload as never)
    })
    runtime.context.eventBus.on('dialogue.failed', (payload) => {
      dialogueFailed.push(payload as never)
    })

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

    await waitFor(() => dialogueFailed.length >= 1)
    const observatory = ctx['elysia.observatory'].service
    // 失败链挂在合成触发刺激上（brain/gateway 请求的 sourceStimulusIds）。
    const trace = observatory.getStimulusTrace(triggerFired[0].stimulusId)
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

    const recent = ctx['elysia.observatory'].service.getRecentEvents(10)

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

    const trace = ctx['elysia.observatory'].service.getStimulusTrace('phase5-sanitize')
    const event = trace?.events[0]

    expect(event?.event).toBe('gateway.failed')
    expect(event?.metadata).toBeDefined()
    expect(JSON.stringify(event?.metadata)).toContain('[Circular]')
    expect(JSON.stringify(event?.metadata)).toContain('[Function]')
  })
})
