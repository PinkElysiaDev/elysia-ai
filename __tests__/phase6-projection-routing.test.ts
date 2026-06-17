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
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { DefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { ProjectionResolver, ProjectionRoutingResult, Stimulus } from '../packages/@elysia-ai/core/src/index.js'
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

  return ctx
}

function installFullPipeline(ctx: any) {
  observatoryPlugin.apply(ctx, { enabled: true, maxRecords: 500 })

  gatewayPlugin.apply(ctx, {
    slots: {
      default: {
        type: 'openai-compatible',
        apiKey: 'test',
        model: 'dialogue-generation',
      },
    },
    defaultSlot: 'default',
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
  })

  brainPlugin.apply(ctx, {
    systemPrompt: 'Phase 6 test',
    contextWindow: 10,
  })

  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
  })

  dialoguePlugin.apply(ctx, { enabled: true })
  bodyPlugin.apply(ctx, {})
}

function installMockProvider(ctx: any, output = 'phase6 reply') {
  const gateway = ctx['elysia-ai-model-gateway']
  const provider = gateway.getRegistry().resolveSlot('default')
  provider.execute = vi.fn(async (request: any) => ({
    output,
    messages: [...request.messages, { role: 'assistant', content: output }],
    provider: { id: 'phase6-provider', type: 'openai-compatible', model: 'dialogue-generation' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
    metadata: {},
  }))
  return provider
}

describe('Phase 6 Projection Routing 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('单 life：stimulus → projection.routed → behavior.instruction → dialogue 完整链路', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-single', type: 'elysia-default' }],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)
    installMockProvider(ctx)

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

    // 验证 projection.routed 事件被 observatory 记录
    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('p6-stim-1')
    const events = trace?.events.map((e: any) => e.event) ?? []

    expect(events).toContain('stimulus.received')
    expect(events).toContain('projection.routed')
    expect(events).toContain('behavior.instruction')
    expect(events).toContain('dialogue.completed')
    expect(events).toContain('body.message.sent')

    // 验证 behavior.instruction 的 lifeId 是从 projection routing 来的
    const instrEvent = trace?.events.find((e: any) => e.event === 'behavior.instruction')
    expect(instrEvent?.metadata?.instruction?.lifeId).toBe('life-single')

    expect(send).toHaveBeenCalled()
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

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('p6-stim-multi')
    const events = trace?.events ?? []

    // 应有 2 个 behavior.instruction（每个 life 一个）
    const instructions = events.filter((e: any) => e.event === 'behavior.instruction')
    expect(instructions).toHaveLength(2)

    const lifeIds = instructions.map((e: any) => e.metadata?.instruction?.lifeId)
    expect(lifeIds).toContain('life-a')
    expect(lifeIds).toContain('life-b')

    // 每个 life 都应触发 dialogue，所以 send 被调用 2 次
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('无匹配 life：projection.routed 发出但不触发 behavior', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    // 不加载任何 life instance
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [],
    })

    ctx = createMockKoishiContext(runtime)
    installFullPipeline(ctx)

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

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('p6-stim-empty')
    const events = trace?.events.map((e: any) => e.event) ?? []

    expect(events).toContain('stimulus.received')
    expect(events).toContain('projection.routed')
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

    const trace = ctx['elysia-ai-observatory'].service.getStimulusTrace('p6-stim-custom')
    const instructions = trace?.events.filter((e: any) => e.event === 'behavior.instruction') ?? []

    // 只有 life-custom 收到 instruction，life-ignored 不应收到
    expect(instructions).toHaveLength(1)
    expect(instructions[0]?.metadata?.instruction?.lifeId).toBe('life-custom')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
