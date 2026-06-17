/**
 * Phase 4 集成测试
 *
 * 验证以下完整主链路：
 * 1. Body 接收 Koishi message 并注入 Runtime stimulus
 * 2. Behavior 消费 stimulus.received 并发出 behavior.instruction
 * 3. Dialogue 消费 behavior.instruction 并调用 Brain
 * 4. Brain 调用 Model Gateway
 * 5. Dialogue 发出 dialogue.output.created
 * 6. Body sender 消费 dialogue.output.created 并发送平台消息
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
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

function installMockProvider(ctx: any, output = 'Elysia phase 4 reply') {
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
      source: 'phase4-test',
    },
  }))

  return provider
}

async function installPipeline(ctx: any) {
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
    systemPrompt: '你是 Elysia Phase 4 测试助手',
    contextWindow: 10,
    defaultModelSlot: 'default',
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

  it('完整链路：message → behavior → dialogue → brain → gateway → body send', async () => {
    await installPipeline(ctx)
    const provider = installMockProvider(ctx)
    const send = vi.fn()

    const events = listenEvents(runtime, [
      'behavior.instruction',
      'dialogue.task.created',
      'dialogue.generation.requested',
      'brain.requested',
      'gateway.requested',
      'dialogue.output.created',
      'sender.completed',
      'body.message.sent',
    ])

    await ctx.receiveMessage({
      messageId: 'phase4-stimulus-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-1',
      userId: 'user-1',
      content: '你好，Elysia',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const dialogueTaskEvents = events['dialogue.task.created'] ?? []
    const executionTaskEvents = dialogueTaskEvents.filter((event) => event.task.metadata?.behaviorExecution === true)
    const mainDialogueTaskEvents = dialogueTaskEvents.filter((event) => event.task.metadata?.behaviorExecution !== true)

    expect(events['behavior.instruction'] ?? []).toHaveLength(1)
    expect(dialogueTaskEvents).toHaveLength(2)
    expect(executionTaskEvents).toHaveLength(1)
    expect(mainDialogueTaskEvents).toHaveLength(1)
    expect(events['dialogue.generation.requested'] ?? []).toHaveLength(1)
    expect(events['brain.requested'] ?? []).toHaveLength(1)
    expect(events['gateway.requested'] ?? []).toHaveLength(1)
    expect(events['dialogue.output.created'] ?? []).toHaveLength(1)
    expect(events['sender.completed'] ?? []).toHaveLength(1)
    expect(events['body.message.sent'] ?? []).toHaveLength(1)

    expect(provider.execute).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('Elysia phase 4 reply')
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
      userId: 'user-2',
      content: '检查输出 payload',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const output = events['dialogue.output.created'][0]
    expect(output.outputId).toBeDefined()
    expect(output.stimulusId).toBe('phase4-stimulus-2')
    expect(output.content).toBe('payload check reply')
    expect(output.task.sourceStimulusIds).toContain('phase4-stimulus-2')
    expect(output.result.output).toBe('payload check reply')
  })

  it('Gateway 失败时应发出 dialogue.failed 且不触发发送', async () => {
    await installPipeline(ctx)
    const gateway = ctx['elysia-ai-model-gateway']
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
      userId: 'user-3',
      content: '触发失败',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    expect(events['dialogue.failed'] ?? []).toHaveLength(1)
    expect(events['dialogue.output.created'] ?? []).toHaveLength(0)
    expect(events['body.message.sent'] ?? []).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })
})
