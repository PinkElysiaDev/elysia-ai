import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import * as observatoryPlugin from '../packages/elysia-ai-observatory/src/index.js'
import * as gatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as memoryPlugin from '../packages/elysia-ai-memory/src/index.js'
import * as bondPlugin from '../packages/elysia-ai-bond/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as bodyPlugin from '../packages/elysia-ai-body/src/index.js'

function createMockKoishiContext(runtime: Runtime) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia-ai-runtime': runtime,
    logger() {
      return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
      for (const handler of handlers.message ?? []) await handler(session)
    },
    dispose() {
      for (const handler of disposeHandlers) handler()
    },
  }
  return ctx
}

function installPipeline(ctx: any, brainSystemPrompt?: string) {
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
    systemPrompt: brainSystemPrompt ?? 'default fallback prompt',
    contextWindow: 10,
  })
  memoryPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
  bondPlugin.apply(ctx, { enabled: true, contextLimit: 5 })
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

function installMockProvider(ctx: any) {
  const gateway = ctx['elysia-ai-model-gateway']
  const provider = gateway.getRegistry().resolveSlot('default')
  const capturedRequests: any[] = []

  provider.execute = vi.fn(async (request: any) => {
    capturedRequests.push(request)
    return {
      output: 'persona reply',
      messages: [...request.messages, { role: 'assistant', content: 'persona reply' }],
      provider: { id: 'p7-provider', type: 'openai-compatible', model: 'dialogue-generation' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      metadata: {},
    }
  })

  return { provider, capturedRequests }
}

async function sendMessage(ctx: any, patch: Partial<any> = {}) {
  await ctx.receiveMessage({
    messageId: patch.messageId ?? 'p7-stimulus',
    id: patch.id ?? 'session-1',
    platform: 'qq',
    selfId: 'bot-1',
    channelId: patch.channelId ?? 'ch-1',
    userId: patch.userId ?? 'user-1',
    content: patch.content ?? 'hello',
    timestamp: Date.now(),
    elements: [],
    send: vi.fn(),
  })
}

describe('Phase 7 Persona Injection integration tests', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('life with persona uses persona.systemPrompt and appends bond context', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-elysia',
        type: 'elysia-default',
        extensions: {
          persona: {
            name: 'Elysia',
            systemPrompt: 'You are Elysia, a gentle virtual life. Reply warmly.',
            traits: ['gentle', 'curious'],
            tone: 'gentle',
          },
        },
      }],
    })

    ctx = createMockKoishiContext(runtime)
    installPipeline(ctx, 'this should NOT be used')
    const { capturedRequests } = installMockProvider(ctx)

    await sendMessage(ctx, { messageId: 'p7-stim-1', channelId: 'ch-1', userId: 'user-1' })

    expect(capturedRequests).toHaveLength(1)
    const systemMsg = capturedRequests[0].messages[0]
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain('You are Elysia')
    expect(systemMsg.content).toContain('Traits: gentle, curious')
    expect(systemMsg.content).toContain('Tone: gentle')
    expect(systemMsg.content).toContain('Relevant relationship context:')
    expect(systemMsg.content).toContain('Do not reveal internal scores or reasons to the user.')
    expect(systemMsg.content).not.toContain('this should NOT be used')
  })

  it('life without persona falls back to config.systemPrompt and appends bond context', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-no-persona',
        type: 'elysia-default',
      }],
    })

    ctx = createMockKoishiContext(runtime)
    installPipeline(ctx, 'fallback system prompt from config')
    const { capturedRequests } = installMockProvider(ctx)

    await sendMessage(ctx, { messageId: 'p7-stim-2', channelId: 'ch-2', userId: 'user-2' })

    expect(capturedRequests).toHaveLength(1)
    const systemMsg = capturedRequests[0].messages[0]
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain('fallback system prompt from config')
    expect(systemMsg.content).toContain('Relevant relationship context:')
    expect(systemMsg.content).toContain('Do not reveal internal scores or reasons to the user.')
  })

  it('multiple lives use their own persona system prompts', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        {
          id: 'life-alice',
          type: 'elysia-default',
          extensions: {
            persona: { name: 'Alice', systemPrompt: 'You are Alice, lively and cheerful.' },
          },
        },
        {
          id: 'life-bob',
          type: 'elysia-default',
          extensions: {
            persona: { name: 'Bob', systemPrompt: 'You are Bob, calm and concise.' },
          },
        },
      ],
    })

    ctx = createMockKoishiContext(runtime)
    installPipeline(ctx)
    const { capturedRequests } = installMockProvider(ctx)

    await sendMessage(ctx, { messageId: 'p7-stim-multi', channelId: 'ch-3', userId: 'user-3' })

    expect(capturedRequests).toHaveLength(2)
    const prompts = capturedRequests.map((request) => request.messages[0].content)
    expect(prompts.some((prompt) => prompt.includes('You are Alice'))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes('You are Bob'))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes('default fallback prompt'))).toBe(false)
  })
})