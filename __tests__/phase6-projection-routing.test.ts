/**
 * Phase 6 Projection Routing 集成测试
 *
 * 验证 projection routing 正式接入主链：
 * 1. 单 life：stimulus → projection.routed → behavior → dialogue 完整链路
 * 2. 多 life：同一 stimulus 路由到多个 life，每个 life 独立 behavior.instruction
 * 3. 无匹配 life：projection.routed 发出但 lifeIds 为空，不触发 behavior
 * 4. 自定义 ProjectionResolver 可注入
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { DefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { ProjectionResolver, ProjectionRoutingResult, Stimulus } from '../packages/@elysia-ai/core/src/index.js'
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
      if (event === 'dispose') disposeHandlers.push(handler)
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
      for (const handler of disposeHandlers) handler()
    },
  }

  return asCordisContext(ctx)
}

function installFullPipeline(ctx: any) {
  observatoryPlugin.apply(ctx, { enabled: true, maxRecords: 500 })

  gatewayPlugin.apply(ctx, {
    providers: {
      default: {
        type: 'chat-completions',
        baseURL: 'https://gateway.test',
        apiKey: 'test',
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
    systemPrompt: 'Phase 6 test',
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

  dialoguePlugin.apply(ctx, { enabled: true })
  bodyPlugin.apply(ctx, {})
}

/**
 * 唤醒协议 mock provider：第 1 轮 send_reply 工具调用，第 2 轮纯文本收尾。
 */
function installMockProvider(ctx: any, output = 'phase6 reply') {
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
        provider: { id: 'phase6-provider', type: 'chat-completions' as const, model: 'dialogue-generation' },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'tool-calls',
        metadata: {},
      }
    }
    return {
      output: 'done',
      messages: [...request.messages, { role: 'assistant' as const, content: 'done' }],
      provider: { id: 'phase6-provider', type: 'chat-completions' as const, model: 'dialogue-generation' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      metadata: {},
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

describe('Phase 6 Projection Routing 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('单 life：stimulus → projection.routed → 触发唤醒 → behavior.instruction → dialogue 完整链路', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-single', type: 'elysia-default' }],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)
    installMockProvider(ctx)

    const instructions: any[] = []
    const dialogueCompleted: any[] = []
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })
    runtime.context.eventBus.on('dialogue.completed', (payload) => {
      dialogueCompleted.push(payload)
    })

    const send = vi.fn()
    await ctx.receiveMessage({
      messageId: 'p6-stim-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'ch-1',
      userId: 'user-1',
      content: 'hello projection',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    await waitFor(() => dialogueCompleted.length >= 1)

    // 验证原始 stimulus 的 trace：入站 + 投影 + 事件入账。
    const trace = ctx['elysia.observatory'].service.getStimulusTrace('p6-stim-1')
    const events = trace?.events.map((e: any) => e.event) ?? []
    expect(events).toContain('stimulus.received')
    expect(events).toContain('projection.routed')
    expect(events).toContain('cognition.event.recorded')

    // 验证 behavior.instruction 的 lifeId 是从 projection routing 来的
    expect(instructions).toHaveLength(1)
    expect(instructions[0].instruction.lifeId).toBe('life-single')
    expect(dialogueCompleted).toHaveLength(1)
  })

  it('多 life：同一 stimulus 路由到多个 life，每个 life 独立 behavior.instruction', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-a', type: 'elysia-default' },
        { id: 'life-b', type: 'elysia-default' },
      ],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)
    installMockProvider(ctx)

    const instructions: any[] = []
    const dialogueCompleted: any[] = []
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })
    runtime.context.eventBus.on('dialogue.completed', (payload) => {
      dialogueCompleted.push(payload)
    })

    const send = vi.fn()
    await ctx.receiveMessage({
      messageId: 'p6-stim-multi',
      id: 'session-2',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'ch-2',
      userId: 'user-2',
      content: 'hello multi life',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    // 两个 life 各自的密度合并器点火，唤醒链经同 habitat 队列排队完成。
    // 合成触发刺激同样经 projection 路由到全部 active life（默认 resolver），
    // 因此每个 life 都会为每次点火产出独立 instruction。
    await waitFor(() => {
      const lifeIds = instructions.map((event: any) => event.instruction.lifeId)
      return lifeIds.includes('life-a') && lifeIds.includes('life-b')
    })
    await waitFor(() => dialogueCompleted.length >= 2)

    // 每个 life 都有独立的 behavior.instruction
    expect(instructions.length).toBeGreaterThanOrEqual(2)
    const lifeIds = instructions.map((event: any) => event.instruction.lifeId)
    expect(lifeIds).toContain('life-a')
    expect(lifeIds).toContain('life-b')

    // 每个 life 都应完成对话
    expect(dialogueCompleted.length).toBeGreaterThanOrEqual(2)
  })

  it('无匹配 life：projection.routed 发出但不触发唤醒', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    // 不加载任何 life instance
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)

    const instructions: any[] = []
    const recordedEvents: any[] = []
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })
    runtime.context.eventBus.on('cognition.event.recorded', (payload) => {
      recordedEvents.push(payload)
    })

    const send = vi.fn()
    await ctx.receiveMessage({
      messageId: 'p6-stim-empty',
      id: 'session-3',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'ch-3',
      userId: 'user-3',
      content: 'hello nobody',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    // 无 life 路由命中：等待可能的异步链落定。
    await new Promise((resolve) => setTimeout(resolve, 200))

    const trace = ctx['elysia.observatory'].service.getStimulusTrace('p6-stim-empty')
    const events = trace?.events.map((e: any) => e.event) ?? []

    expect(events).toContain('stimulus.received')
    expect(events).toContain('projection.routed')
    expect(recordedEvents).toHaveLength(0)
    expect(instructions).toHaveLength(0)
    expect(events).not.toContain('behavior.instruction')
    expect(events).not.toContain('dialogue.completed')
    expect(send).not.toHaveBeenCalled()
  })

  it('自定义 ProjectionResolver 可注入并生效', async () => {
    // 自定义 resolver：只路由到 life-custom
    const customResolver: ProjectionResolver = {
      resolve(stimulus: Stimulus): ProjectionRoutingResult {
        return {
          stimulusId: stimulus.id,
          habitatId: stimulus.habitatId,
          lifeIds: ['life-custom'],
          projectionIds: ['proj-custom'],
          routedAt: Date.now(),
          reason: 'custom resolver',
        }
      },
    }

    runtime = createDefaultRuntime()
    // 注入自定义 resolver
    ;(runtime as any).projectionResolver = customResolver

    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-custom', type: 'elysia-default' },
        { id: 'life-ignored', type: 'elysia-default' },
      ],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)
    installMockProvider(ctx)

    const instructions: any[] = []
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructions.push(payload)
    })

    const send = vi.fn()
    await ctx.receiveMessage({
      messageId: 'p6-stim-custom',
      id: 'session-4',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'ch-4',
      userId: 'user-4',
      content: 'hello custom',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    await waitFor(() => instructions.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 只有 life-custom 收到 instruction，life-ignored 不应收到
    expect(instructions).toHaveLength(1)
    expect(instructions[0].instruction.lifeId).toBe('life-custom')
  })
})
