import { describe, expect, it, vi } from 'vitest'
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

  const ctx: any = {
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

function applyMinimalDialogueChain(ctx: any) {
  gatewayPlugin.apply(ctx, {
    slots: { default: { type: 'openai-compatible', apiKey: 'test', model: 'dialogue-generation' } },
    defaultSlot: 'default',
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
  })
  brainPlugin.apply(ctx, { systemPrompt: 'phase37 system prompt', contextWindow: 10 })
  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
  })
  dialoguePlugin.apply(ctx, { enabled: true, memoryLimit: 10 })
  bodyPlugin.apply(ctx, {})
}

describe('Phase 37 multi-plugin Koishi composition', () => {
  it('runtime plugin registers canonical runtime service without an aggregator', async () => {
    const ctx = createMockKoishiContext()

    await runtimePlugin.apply(ctx, {})

    expect(ctx['elysia.runtime']).toBeTruthy()
    expect(ctx['elysia.runtime']).toBe(ctx['elysia-ai-runtime'])
    await ctx['elysia.runtime'].stop()
    ctx.dispose()
    expect(ctx['elysia.runtime']).toBeUndefined()
  })

  it('minimal dialogue chain uses canonical services and completes one message reply', async () => {
    const runtime = await startRuntime()
    const ctx = createMockKoishiContext(runtime)
    const sent: string[] = []

    applyMinimalDialogueChain(ctx)

    expect(ctx['elysia.modelGateway']).toBeTruthy()
    expect(ctx['elysia.brain']).toBeTruthy()
    expect(ctx['elysia.behavior'].getDiagnostics().serviceName).toBe('elysia.behavior')
    expect(ctx['elysia.dialogue']).toBeTruthy()
    expect(ctx['elysia.body'].getDiagnostics().serviceName).toBe('elysia.body')

    const provider = ctx['elysia.modelGateway'].getRegistry().resolveSlot('default')
    provider.execute = vi.fn(async (request: any) => ({
      output: 'phase37 reply',
      messages: [...request.messages, { role: 'assistant', content: 'phase37 reply' }],
      provider: { id: 'slot:default', type: 'openai-compatible', model: 'dialogue-generation' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      metadata: {},
    }))

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

    expect(provider.execute).toHaveBeenCalledTimes(1)
    expect(sent).toContain('phase37 reply')

    ctx.dispose()
    await runtime.stop()
  })

  it('full life chain installs independent capability plugins and exposes typed facades', async () => {
    const runtime = await startRuntime()
    const ctx = createMockKoishiContext(runtime)

    observatoryPlugin.apply(ctx, { enabled: true, maxRecords: 500 })
    gatewayPlugin.apply(ctx, {
      slots: { default: { type: 'openai-compatible', apiKey: 'test', model: 'dialogue-generation' } },
      defaultSlot: 'default',
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    })
    brainPlugin.apply(ctx, { systemPrompt: 'phase37 full system prompt', contextWindow: 10 })
    memoryPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
    bondPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
    personaPlugin.apply(ctx, { defaultName: 'Elysia', defaultSystemPrompt: 'You are Elysia.', defaultTone: 'gentle', registerDefaultPersona: false })
    perceptionPlugin.apply(ctx, { maxInputTokens: 8192, enabledIntentClassify: true, enabledEntityExtract: true, enabledSentiment: true, aiEnhanced: false, aiFallbackToRuleBased: true, aiMinTextLength: 12, aiModelSlot: '' })
    homeostasisPlugin.apply(ctx, { enabled: true, restoreOnStartup: false } as any)
    cognitionPlugin.apply(ctx, { aiEnhanced: false, aiFallbackToRuleBased: true, aiModelSlot: '' } as any)
    behaviorPlugin.apply(ctx, { enableReply: true, directWindowMs: 1500, userBufferedWindowMs: 2500, threadBufferedWindowMs: 3500, habitatBufferedWindowMs: 5000 })
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
