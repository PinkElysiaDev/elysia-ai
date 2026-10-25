import { describe, expect, it, vi } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime, type Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import * as runtimePlugin from '../packages/elysia-ai-runtime/src/index.js'
import * as observatoryPlugin from '../packages/elysia-ai-observatory/src/index.js'
import * as gatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as memoryPlugin from '../packages/elysia-ai-memory/src/index.js'
import * as bondPlugin from '../packages/elysia-ai-bond/src/index.js'
import * as personaPlugin from '../packages/elysia-ai-persona/src/index.js'
import * as perceptionPlugin from '../packages/elysia-ai-perception/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as bodyPlugin from '../packages/elysia-ai-body/src/index.js'

function createMockKoishiContext(runtime?: Runtime) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []
  const commands: Array<{ name: string, description?: string, action?: (...args: any[]) => any }> = []

  const base: any = {
    ...(runtime ? { 'elysia.runtime': runtime } : {}),
    logger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    command: vi.fn((name: string, description?: string) => {
      const command = { name, description, action: undefined as undefined | ((...args: any[]) => any) }
      commands.push(command)
      return {
        action(handler: (...args: any[]) => any) {
          command.action = handler
          return this
        },
      }
    }),
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
      for (const handler of handlers.message ?? []) await handler(session)
    },
    dispose() {
      for (const handler of disposeHandlers) handler()
    },
    __commands: commands,
  }

  // 补齐 cordis 服务机制（ctx.set/get/reflect.alias），并模拟插件作用域语义：
  // 生产代码 registerElysiaService 依赖 cordis effect 在作用域 dispose 时自动置空服务，
  // mock 无 effect 机制，这里让 ctx.dispose() 在执行完 dispose handlers 后撤销期间注册的服务。
  const scopedServiceUndos: Array<() => void> = []
  const ctx = new Proxy(asCordisContext(base), {
    get(target: any, prop, receiver) {
      if (prop === 'set') {
        return (name: string, value: unknown) => {
          target.set(name, value)
          if (value !== undefined) scopedServiceUndos.push(() => target.set(name, undefined))
        }
      }
      if (prop === 'dispose') {
        return () => {
          base.dispose()
          for (const undo of scopedServiceUndos.splice(0)) undo()
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  return ctx
}

async function startRuntime() {
  const runtime = createDefaultRuntime()
  await runtime.start()
  await runtime.loadManifest({
    version: '1.0',
    lifeInstances: [{ id: 'life-phase37', type: 'elysia-default' }],
  })
  return runtime
}

function gatewayConfig() {
  return {
    providers: {
      default: { type: 'chat-completions', apiKey: 'test', baseURL: 'https://phase37.example' },
    },
    providerSlots: {
      default: { provider: 'default', model: 'dialogue-generation' },
    },
    defaultSlot: 'default',
    maxRetries: 0,
    baseDelayMs: 1,
    maxDelayMs: 1,
  }
}

function applyMinimalDialogueChain(ctx: any) {
  gatewayPlugin.apply(ctx, gatewayConfig() as any)
  brainPlugin.apply(ctx, { systemPrompt: 'phase37 system prompt', contextWindow: 10 })
  // cognition（事件注入层）先于 behavior 注册：behavior 依赖 elysia.cognition 服务。
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
  dialoguePlugin.apply(ctx, { enabled: true, memoryLimit: 10 })
  bodyPlugin.apply(ctx, {})
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('Phase 37 multi-plugin Koishi composition', () => {
  it('runtime plugin registers canonical runtime service without an aggregator', async () => {
    const ctx = createMockKoishiContext()

    await runtimePlugin.apply(ctx, {})

    expect(ctx['elysia.runtime']).toBeTruthy()
    expect(ctx['elysia.runtime']).toBe(ctx['elysia.runtime'])
    await ctx['elysia.runtime'].stop()
    ctx.dispose()
    expect(ctx['elysia.runtime']).toBeUndefined()
  })

  it('minimal dialogue chain uses canonical services and completes one wake reply', async () => {
    const runtime = await startRuntime()
    const ctx = createMockKoishiContext(runtime)
    const sent: string[] = []

    applyMinimalDialogueChain(ctx)

    expect(ctx['elysia.modelGateway']).toBeTruthy()
    expect(ctx['elysia.brain']).toBeTruthy()
    expect(ctx['elysia.cognition'].getDiagnostics().serviceName).toBe('elysia.cognition')
    expect(ctx['elysia.behavior'].getDiagnostics().serviceName).toBe('elysia.behavior')
    expect(ctx['elysia.dialogue']).toBeTruthy()
    expect(ctx['elysia.body'].getDiagnostics().serviceName).toBe('elysia.body')

    const provider = ctx['elysia.modelGateway'].getRegistry().resolveSlot('default')
    const dialogueOutputs: string[] = []
    // 唤醒协议 mock provider：第 1 轮 send_reply 工具调用，第 2 轮纯文本收尾。
    let round = 0
    provider.execute = vi.fn(async (request: any) => {
      round++
      if (round === 1) {
        const toolCalls = [{
          id: 'call-send-1',
          type: 'function' as const,
          name: 'send_reply',
          arguments: { text: 'phase37 reply' },
        }]
        return {
          output: '',
          toolCalls,
          messages: [...request.messages, { role: 'assistant' as const, content: '', toolCalls }],
          provider: { id: 'slot:default', type: 'chat-completions' as const, model: 'dialogue-generation' },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'tool-calls',
          metadata: {},
        }
      }
      return {
        output: 'done',
        messages: [...request.messages, { role: 'assistant' as const, content: 'done' }],
        provider: { id: 'slot:default', type: 'chat-completions' as const, model: 'dialogue-generation' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        metadata: {},
      }
    })
    runtime.context.eventBus.on('dialogue.output.created', (payload) => {
      dialogueOutputs.push(payload.content)
    })

    await ctx.receiveMessage({
      messageId: 'phase37-message',
      id: 'session-phase37',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'phase37-channel',
      userId: 'phase37-user',
      content: 'hello phase37',
      timestamp: Date.now(),
      elements: [],
      send: vi.fn(async (content: string) => sent.push(content)),
    })

    // 触发唤醒链经同 habitat 队列异步完成。
    await waitFor(() => dialogueOutputs.length >= 1)

    expect(provider.execute.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(dialogueOutputs).toContain('phase37 reply')

    ctx.dispose()
    await runtime.stop()
  })

  it('full life chain installs independent capability plugins and exposes typed facades', async () => {
    const runtime = await startRuntime()
    const ctx = createMockKoishiContext(runtime)

    observatoryPlugin.apply(ctx, { enabled: true, maxRecords: 500 })
    gatewayPlugin.apply(ctx, gatewayConfig() as any)
    brainPlugin.apply(ctx, { systemPrompt: 'phase37 full system prompt', contextWindow: 10 })
    memoryPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
    bondPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
    personaPlugin.apply(ctx, { defaultName: 'Elysia', defaultSystemPrompt: 'You are Elysia.', defaultTone: 'gentle', registerDefaultPersona: false })
    perceptionPlugin.apply(ctx, { maxInputTokens: 8192, enabledIntentClassify: true, enabledEntityExtract: true, enabledSentiment: true, aiEnhanced: false, aiFallbackToRuleBased: true, aiMinTextLength: 12, aiModelSlot: '' })
    homeostasisPlugin.apply(ctx, { enabled: true, restoreOnStartup: false } as any)
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
        maxBatch: 50,
      },
      packMemory: { maxPacks: 12, injectPacks: 2 },
    })
    dialoguePlugin.apply(ctx, { enabled: true, memoryLimit: 10 })
    bodyPlugin.apply(ctx, {})

    const serviceNames = [
      'elysia.observatory',
      'elysia.modelGateway',
      'elysia.brain',
      'elysia.memory',
      'elysia.bond',
      'elysia.persona',
      'elysia.perception',
      'elysia.homeostasis',
      'elysia.cognition',
      'elysia.behavior',
      'elysia.dialogue',
      'elysia.body',
    ]

    for (const serviceName of serviceNames) {
      expect(ctx[serviceName], serviceName).toBeTruthy()
    }

    expect(ctx['elysia.observatory'].getDiagnostics().serviceName).toBe('elysia.observatory')
    expect(ctx['elysia.persona'].getDiagnostics().serviceName).toBe('elysia.persona')
    expect(ctx['elysia.perception'].getDiagnostics().serviceName).toBe('elysia.perception')
    expect(ctx['elysia.cognition'].getDiagnostics().serviceName).toBe('elysia.cognition')
    expect(ctx['elysia.behavior'].getDiagnostics().serviceName).toBe('elysia.behavior')

    ctx.dispose()
    expect(ctx['elysia.observatory']).toBeUndefined()
    expect(ctx['elysia.behavior']).toBeUndefined()
    await runtime.stop()
  })

  it('dialogue degrades when memory and bond plugins are not installed', async () => {
    const runtime = await startRuntime()
    const ctx = createMockKoishiContext(runtime)

    applyMinimalDialogueChain(ctx)

    expect(ctx['elysia.memory']).toBeUndefined()
    expect(ctx['elysia.bond']).toBeUndefined()
    expect(ctx['elysia.dialogue']).toBeTruthy()

    ctx.dispose()
    await runtime.stop()
  })
})
