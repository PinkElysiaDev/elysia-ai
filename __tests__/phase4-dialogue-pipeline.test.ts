/**
 * Phase 4 集成测试
 *
 * 验证以下完整主链路（触发器重构后）：
 * 1. Body 接收 Koishi message 并注入 Runtime stimulus
 * 2. Cognition 将 stimulus 入账为事件，Behavior 密度合并器点火触发唤醒
 * 3. 合成触发刺激走完整主链，Behavior 发出 behavior.instruction
 * 4. Dialogue（agentic 工具循环）消费 instruction 并调用 Brain
 * 5. Brain 调用 Model Gateway，模型经 send_reply 工具产出发言段
 * 6. Dialogue 发出 dialogue.output.created（每段一条）
 *
 * 注：唤醒回复的平台投递（sender → session.send）依赖合成刺激的
 * 出站路由解析，当前 body 侧尚未消费 task.metadata.routing（见
 * sender/index.ts 的 createPlatformSendTaskFromDialogue），本文件断言
 * 到 dialogue.output.created / dialogue.completed 为止。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as gatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as bodyPlugin from '../packages/elysia-ai-body/src/index.js'

// ---------------------------------------------------------------------------
// 工具：Koishi Context mock
// ---------------------------------------------------------------------------

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

function listenEvents(runtime: Runtime, names: string[]) {
  const events: Record<string, any[]> = {}
  const bus = runtime.context.eventBus as any

  for (const name of names) {
    bus.on(name, (payload: any) => {
      ;(events[name] ??= []).push(payload)
    })
  }

  return events
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * 唤醒协议 mock provider：第 1 轮返回 send_reply 工具调用（产出一段发言），
 * 第 2 轮返回纯文本收尾（工具循环结束）。
 */
function installMockProvider(ctx: any, output = 'Elysia phase 4 reply') {
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
        metadata: { source: 'phase4-test' },
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
      metadata: { source: 'phase4-test' },
    }
  })

  return provider
}

async function installPipeline(ctx: any) {
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
    systemPrompt: '你是 Elysia Phase 4 测试助手',
    contextWindow: 10,
    defaultModelSlot: 'default',
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

async function createStartedRuntime() {
  const runtime = createDefaultRuntime()
  await runtime.start()
  await runtime.loadManifest({
    version: '1.0',
    lifeInstances: [{ id: 'life-phase4', type: 'elysia-default' }],
  })
  return runtime
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('Phase 4 Dialogue Pipeline 集成测试', () => {
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

  it('完整链路：message → cognition → behavior 触发唤醒 → dialogue(agentic) → brain → gateway', async () => {
    await installPipeline(ctx)
    const provider = installMockProvider(ctx)
    const send = vi.fn()

    const events = listenEvents(runtime, [
      'cognition.event.recorded',
      'behavior.trigger.fired',
      'behavior.instruction',
      'dialogue.task.created',
      'dialogue.generation.requested',
      'brain.requested',
      'gateway.requested',
      'dialogue.output.created',
      'dialogue.completed',
    ])

    await ctx.receiveMessage({
      messageId: 'phase4-stimulus-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-1',
      guildId: 'channel-1',      userId: 'user-1',
      content: '你好，Elysia',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    await waitFor(() => (events['dialogue.completed'] ?? []).length >= 1)

    // 原始刺激：入账 cognition 事件 + 触发器点火（maxBatch=1）。
    expect(events['cognition.event.recorded'] ?? []).toHaveLength(1)
    expect(events['cognition.event.recorded'][0].stimulusId).toBe('phase4-stimulus-1')
    expect(events['behavior.trigger.fired'] ?? []).toHaveLength(1)
    expect(events['behavior.trigger.fired'][0].source).toBe('batcher')

    // 唤醒链：一条 instruction，一个 dialogue task（agentic 唤醒），
    // brain/gateway 至少各一轮，产出一条 output。
    expect(events['behavior.instruction'] ?? []).toHaveLength(1)
    expect(events['dialogue.task.created'] ?? []).toHaveLength(1)
    expect(events['dialogue.generation.requested'] ?? []).toHaveLength(1)
    expect((events['brain.requested'] ?? []).length).toBeGreaterThanOrEqual(1)
    expect((events['gateway.requested'] ?? []).length).toBeGreaterThanOrEqual(1)
    expect(events['dialogue.output.created'] ?? []).toHaveLength(1)
    expect(events['dialogue.output.created'][0].content).toBe('Elysia phase 4 reply')

    expect(provider.execute.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('Dialogue 输出事件应包含可路由的输出 payload', async () => {
    await installPipeline(ctx)
    installMockProvider(ctx, 'payload check reply')
    const send = vi.fn()

    const events = listenEvents(runtime, ['dialogue.output.created'])

    await ctx.receiveMessage({
      messageId: 'phase4-stimulus-2',
      id: 'session-2',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-2',
      guildId: 'channel-2',      userId: 'user-2',
      content: '检查输出 payload',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    await waitFor(() => (events['dialogue.output.created'] ?? []).length >= 1)

    const output = events['dialogue.output.created'][0]
    expect(output.outputId).toBeDefined()
    // 输出挂在合成触发刺激上（channelId 即 habitat），不再是原始消息 id。
    expect(output.stimulusId).toMatch(/^channel-2:trigger:batcher:\d+-\d+$/)
    expect(output.habitatId).toBe('channel-2')
    expect(output.content).toBe('payload check reply')
    expect(output.task.sourceStimulusIds).toContain(output.stimulusId)
    expect(output.result.output).toBe('payload check reply')
  })

  it('Gateway 失败时应发出 dialogue.failed 且不触发发送', async () => {
    await installPipeline(ctx)
    const gateway = ctx['elysia.modelGateway']
    const provider = gateway.getRegistry().resolveSlot('default')
    provider.execute = vi.fn(async () => {
      throw new Error('phase4 gateway failure')
    })

    const send = vi.fn()
    const events = listenEvents(runtime, [
      'dialogue.failed',
      'dialogue.output.created',
      'body.message.sent',
    ])

    await ctx.receiveMessage({
      messageId: 'phase4-stimulus-3',
      id: 'session-3',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-3',
      guildId: 'channel-3',      userId: 'user-3',
      content: '触发失败',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    await waitFor(() => (events['dialogue.failed'] ?? []).length >= 1)

    expect(events['dialogue.failed'] ?? []).toHaveLength(1)
    expect(events['dialogue.output.created'] ?? []).toHaveLength(0)
    expect(events['body.message.sent'] ?? []).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })
})
