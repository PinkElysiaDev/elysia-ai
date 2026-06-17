
import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'koishi'
import type { BrainService, ModelGatewayService } from '../packages/@elysia-ai/core/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { apply as applyBehavior } from '../packages/elysia-ai-behavior/src/index.js'
import { apply as applyBody } from '../packages/elysia-ai-body/src/index.js'
import { apply as applyBond } from '../packages/elysia-ai-bond/src/index.js'
import { apply as applyBrain } from '../packages/elysia-ai-brain/src/index.js'
import { apply as applyCognition } from '../packages/elysia-ai-cognition/src/index.js'
import { apply as applyDialogue } from '../packages/elysia-ai-dialogue/src/index.js'
import { apply as applyHomeostasis } from '../packages/elysia-ai-homeostasis/src/index.js'
import { apply as applyMemory } from '../packages/elysia-ai-memory/src/index.js'
import { apply as applyModelGateway } from '../packages/elysia-ai-model-gateway/src/index.js'
import { apply as applyObservatory } from '../packages/elysia-ai-observatory/src/index.js'
import { apply as applyPerception } from '../packages/elysia-ai-perception/src/index.js'
import { apply as applyPersona } from '../packages/elysia-ai-persona/src/index.js'

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createPluginContext() {
  const disposers: Array<() => void | Promise<void>> = []
  const ctx: any = {
    logger: vi.fn(() => createLogger()),
    command: vi.fn(() => ({ action: vi.fn() })),
    on: vi.fn((event: string, handler: () => void | Promise<void>) => {
      if (event === 'dispose') disposers.push(handler)
      return () => {}
    }),
  }
  return { ctx: ctx as Context & Record<string, any>, disposers }
}

function attachRuntime(ctx: Record<string, any>) {
  const runtime = createDefaultRuntime()
  ctx['elysia.runtime'] = runtime
  ctx['elysia-ai-runtime'] = runtime
  return runtime
}

function attachModelGateway(ctx: Record<string, any>) {
  const modelGateway: ModelGatewayService = {
    execute: vi.fn(async () => ({ output: 'ok', messages: [] })),
  }
  ctx['elysia.modelGateway'] = modelGateway
  ctx['elysia-ai-model-gateway'] = modelGateway
  return modelGateway
}

function attachBrain(ctx: Record<string, any>) {
  const brain = {
    think: vi.fn(async () => ({ output: 'ok', messages: [], metadata: {} })),
  } as unknown as BrainService
  ctx['elysia.brain'] = brain
  ctx['elysia-ai-brain'] = brain
  return brain
}

async function disposeAll(disposers: Array<() => void | Promise<void>>) {
  for (const dispose of disposers) await dispose()
}

const behaviorConfig = {
  enableReply: true,
  directWindowMs: 1500,
  userBufferedWindowMs: 2500,
  threadBufferedWindowMs: 3500,
  habitatBufferedWindowMs: 5000,
}

const perceptionConfig = {
  maxInputTokens: 8192,
  enabledIntentClassify: true,
  enabledEntityExtract: true,
  enabledSentiment: true,
  aiEnhanced: false,
  aiFallbackToRuleBased: true,
  aiMinTextLength: 12,
  aiModelSlot: '',
}

const cognitionConfig = {
  recentConversationLimit: 12,
  salienceDirectMentionBonus: 0.35,
  salienceDirectMessageBonus: 0.25,
  salienceReplyBonus: 0.2,
  salienceQuestionBonus: 0.15,
  salienceLengthFactor: 0.001,
  behaviorThreshold: 0.35,
  aiEnhanced: false,
  aiFallbackToRuleBased: true,
  aiMinSalience: 0.2,
  aiModelSlot: '',
}

const homeostasisConfig = {
  initialEnergy: 0.8,
  initialMood: 0.6,
  initialSociability: 0.5,
  initialCuriosity: 0.7,
  energyDecayPerTick: 0.01,
  moodDecayPerTick: 0.005,
  sociabilityDecayPerTick: 0.003,
  curiosityDecayPerTick: 0.002,
  maxValue: 1,
  minValue: 0,
  responseThresholdMin: 0.3,
  responseThresholdMax: 0.8,
  restoreOnStartup: true,
}

const personaConfig = {
  defaultName: 'Elysia',
  defaultSystemPrompt: 'You are Elysia.',
  defaultTone: 'gentle',
  registerDefaultPersona: false,
}

const plugins = [
  ['behavior', 'elysia.behavior', 'elysia-ai-behavior', applyBehavior, behaviorConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['body', 'elysia.body', 'elysia-ai-body', applyBody, {}, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['bond', 'elysia.bond', 'elysia-ai-bond', applyBond, { enabled: true, contextLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['brain', 'elysia.brain', 'elysia-ai-brain', applyBrain, {}, (ctx: Record<string, any>) => { attachRuntime(ctx); attachModelGateway(ctx) }],
  ['cognition', 'elysia.cognition', 'elysia-ai-cognition', applyCognition, cognitionConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['dialogue', 'elysia.dialogue', 'elysia-ai-dialogue', applyDialogue, { enabled: true, memoryLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx); attachBrain(ctx) }],
  ['homeostasis', 'elysia.homeostasis', 'elysia-ai-homeostasis', applyHomeostasis, homeostasisConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['memory', 'elysia.memory', 'elysia-ai-memory', applyMemory, { enabled: true, contextLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['model-gateway', 'elysia.modelGateway', 'elysia-ai-model-gateway', applyModelGateway, { slots: {} }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['observatory', 'elysia.observatory', 'elysia-ai-observatory', applyObservatory, { enabled: true, maxRecords: 20 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['perception', 'elysia.perception', 'elysia-ai-perception', applyPerception, perceptionConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['persona', 'elysia.persona', 'elysia-ai-persona', applyPersona, personaConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
] as const

describe('Phase 42 top-level plugin assembly contracts', () => {
  it.each(plugins)('%s registers canonical and legacy services and clears them on dispose', async (_label, formalName, legacyName, apply, config, setup) => {
    const { ctx, disposers } = createPluginContext()
    setup(ctx)

    apply(ctx, config as never)

    expect(ctx[formalName]).toBeTruthy()
    expect(ctx[legacyName]).toBe(ctx[formalName])

    await disposeAll(disposers)

    expect(ctx[formalName]).toBeUndefined()
    expect(ctx[legacyName]).toBeUndefined()
  })

  it('dialogue registers without optional memory and bond services', () => {
    const { ctx } = createPluginContext()
    attachRuntime(ctx)
    attachBrain(ctx)

    applyDialogue(ctx, { enabled: true, memoryLimit: 5 })

    expect(ctx['elysia.dialogue']).toBeTruthy()
    expect(ctx['elysia-ai-dialogue']).toBe(ctx['elysia.dialogue'])
  })

  it('perception and cognition register without optional brain service', () => {
    const perception = createPluginContext()
    attachRuntime(perception.ctx)
    applyPerception(perception.ctx, perceptionConfig)
    expect(perception.ctx['elysia.perception']).toBeTruthy()

    const cognition = createPluginContext()
    attachRuntime(cognition.ctx)
    applyCognition(cognition.ctx, cognitionConfig)
    expect(cognition.ctx['elysia.cognition']).toBeTruthy()
  })

  it('memory and bond fill and clear runtime compatibility fields', async () => {
    const memory = createPluginContext()
    const memoryRuntime = attachRuntime(memory.ctx)
    applyMemory(memory.ctx, { enabled: true, contextLimit: 5 })
    expect(memoryRuntime.memoryRepository).toBeTruthy()
    expect(memoryRuntime.memoryService).toBeTruthy()
    expect(memoryRuntime.memoryContextProvider).toBeTruthy()
    await disposeAll(memory.disposers)
    expect(memoryRuntime.memoryRepository).toBeUndefined()
    expect(memoryRuntime.memoryService).toBeUndefined()
    expect(memoryRuntime.memoryContextProvider).toBeUndefined()

    const bond = createPluginContext()
    const bondRuntime = attachRuntime(bond.ctx)
    applyBond(bond.ctx, { enabled: true, contextLimit: 5 })
    expect(bondRuntime.bondRepository).toBeTruthy()
    expect(bondRuntime.bondService).toBeTruthy()
    expect(bondRuntime.bondContextProvider).toBeTruthy()
    await disposeAll(bond.disposers)
    expect(bondRuntime.bondRepository).toBeUndefined()
    expect(bondRuntime.bondService).toBeUndefined()
    expect(bondRuntime.bondContextProvider).toBeUndefined()
  })
})
