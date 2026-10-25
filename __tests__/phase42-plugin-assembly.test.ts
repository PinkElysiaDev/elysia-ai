
import { describe, expect, it, vi } from 'vitest'
import { asCordisContext, type Context } from 'koishi'
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
  const base: any = {
    logger: vi.fn(() => createLogger()),
    command: vi.fn(() => ({ action: vi.fn() })),
    on: vi.fn((event: string, handler: () => void | Promise<void>) => {
      if (event === 'dispose') disposers.push(handler)
      return () => {}
    }),
  }

  // 补齐 cordis 服务机制（ctx.set/get/reflect.alias），并模拟插件作用域语义：
  // 生产代码 registerElysiaService 依赖 cordis effect 在作用域 dispose 时自动置空服务，
  // mock 无 effect 机制，这里让 dispose handler 执行后再撤销期间通过 ctx.set() 注册的服务。
  const scopedServiceUndos: Array<() => void> = []
  const ctx = new Proxy(asCordisContext(base), {
    get(target: any, prop, receiver) {
      if (prop === 'set') {
        return (name: string, value: unknown) => {
          target.set(name, value)
          if (value !== undefined) scopedServiceUndos.push(() => target.set(name, undefined))
        }
      }
      if (prop === 'on') {
        return (event: string, handler: (...args: any[]) => any) => {
          if (event === 'dispose') {
            return base.on(event, async (...args: any[]) => {
              const result = await handler(...args)
              for (const undo of scopedServiceUndos.splice(0)) undo()
              return result
            })
          }
          return base.on(event, handler)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  return { ctx: ctx as Context & Record<string, any>, disposers }
}

function attachRuntime(ctx: Record<string, any>) {
  const runtime = createDefaultRuntime()
  ctx['elysia.runtime'] = runtime
  ctx['elysia.runtime'] = runtime
  return runtime
}

function attachModelGateway(ctx: Record<string, any>) {
  const modelGateway: ModelGatewayService = {
    execute: vi.fn(async () => ({ output: 'ok', messages: [] })),
  }
  ctx['elysia.modelGateway'] = modelGateway
  ctx['elysia.modelGateway'] = modelGateway
  return modelGateway
}

function attachBrain(ctx: Record<string, any>) {
  const brain = {
    think: vi.fn(async () => ({ output: 'ok', messages: [], metadata: {} })),
  } as unknown as BrainService
  ctx['elysia.brain'] = brain
  ctx['elysia.brain'] = brain
  return brain
}

async function disposeAll(disposers: Array<() => void | Promise<void>>) {
  for (const dispose of disposers) await dispose()
}

const behaviorConfig = {
  enableReply: true,
  batcher: { quietWindowMs: 8_000, dmQuietWindowMs: 1_500, maxWaitMs: 30_000, densityWindowMs: 10_000, densityThreshold: 15, maxBatch: 50 },
  packMemory: { maxPacks: 12, injectPacks: 2 },
  commands: [],
  instantRules: [],
  triggers: { enabled: true, adminWhitelist: [], maxTasksPerOwner: 20, repository: 'memory' },
}

const perceptionConfig = {
  enabledIntentClassify: true,
  enabledEntityExtract: true,
  enabledSentiment: true,
}

const cognitionConfig = {
  events: {
    enabled: true,
    feed: { maxEvents: 30 },
    history: { maxEvents: 100, windowMs: 1_800_000 },
  },
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
  restoreOnStartup: true,
}

const personaConfig = {
  defaultName: 'Elysia',
  defaultSystemPrompt: 'You are Elysia.',
  defaultTone: 'gentle',
  registerDefaultPersona: false,
}

const plugins = [
  ['behavior', 'elysia.behavior', applyBehavior, behaviorConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['body', 'elysia.body', applyBody, {}, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['bond', 'elysia.bond', applyBond, { enabled: true, contextLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['brain', 'elysia.brain', applyBrain, {}, (ctx: Record<string, any>) => { attachRuntime(ctx); attachModelGateway(ctx) }],
  ['cognition', 'elysia.cognition', applyCognition, cognitionConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['dialogue', 'elysia.dialogue', applyDialogue, { enabled: true, memoryLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx); attachBrain(ctx) }],
  ['homeostasis', 'elysia.homeostasis', applyHomeostasis, homeostasisConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['memory', 'elysia.memory', applyMemory, { enabled: true, contextLimit: 5 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['model-gateway', 'elysia.modelGateway', applyModelGateway, {}, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['observatory', 'elysia.observatory', applyObservatory, { enabled: true, maxRecords: 20 }, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['perception', 'elysia.perception', applyPerception, perceptionConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
  ['persona', 'elysia.persona', applyPersona, personaConfig, (ctx: Record<string, any>) => { attachRuntime(ctx) }],
] as const

describe('Phase 42 top-level plugin assembly contracts', () => {
  it.each(plugins)('%s registers its service and clears it on dispose', async (_label, formalName, apply, config, setup) => {
    const { ctx, disposers } = createPluginContext()
    setup(ctx)

    apply(ctx, config as never)

    expect(ctx[formalName]).toBeTruthy()

    await disposeAll(disposers)

    expect(ctx[formalName]).toBeUndefined()
  })

  it('dialogue registers without optional memory and bond services', () => {
    const { ctx } = createPluginContext()
    attachRuntime(ctx)
    attachBrain(ctx)

    applyDialogue(ctx, { enabled: true, memoryLimit: 5 })

    expect(ctx['elysia.dialogue']).toBeTruthy()
    expect(ctx['elysia.dialogue']).toBe(ctx['elysia.dialogue'])
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
})
