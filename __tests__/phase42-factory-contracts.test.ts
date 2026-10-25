
import { describe, expect, it, vi } from 'vitest'
import {
  ELYSIA_PIPELINE_STAGES,
  MemoryEventBus,
  PipelineRunner,
  type BrainService,
  type CoreEventMap,
  type ConversationStore,
  type HomeostasisService,
  type LifeInstance,
  type LifeStateRepository,
  type ModelGatewayService,
  type PersonaRegistry,
} from '../packages/@elysia-ai/core/src/index.js'
import { createBehaviorPluginRuntime } from '../packages/@elysia-ai/behavior/src/index.js'
import { createBondPluginRuntime } from '../packages/@elysia-ai/bond/src/index.js'
import { createBrainPluginRuntime } from '../packages/@elysia-ai/brain/src/index.js'
import { createCognitionPluginRuntime } from '../packages/@elysia-ai/cognition/src/index.js'
import { createDialoguePluginRuntime } from '../packages/@elysia-ai/dialogue/src/index.js'
import { createHomeostasisPluginRuntime } from '../packages/@elysia-ai/homeostasis/src/index.js'
import { createMemoryPluginRuntime } from '../packages/@elysia-ai/memory/src/index.js'
import { createModelGatewayPluginRuntime } from '../packages/@elysia-ai/model-gateway/src/index.js'
import { createObservatoryPluginRuntime } from '../packages/@elysia-ai/observatory/src/index.js'
import { createPerceptionPluginRuntime } from '../packages/@elysia-ai/perception/src/index.js'
import { createPersonaPluginRuntime } from '../packages/@elysia-ai/persona/src/index.js'

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createRuntime() {
  // 主链单轨：工厂契约测试同样走管线钩子装配（与 DefaultRuntime 的补齐方式一致）
  const pipeline = new PipelineRunner<unknown>({ onError: () => {} })
  for (const stage of ELYSIA_PIPELINE_STAGES) pipeline.registerStage(stage)
  return {
    context: { eventBus: new MemoryEventBus<CoreEventMap>(), pipeline },
  }
}

function createPersonaRegistry(): PersonaRegistry {
  const personas = new Map<string, any>()
  return {
    register(persona) { personas.set(persona.lifeId, persona) },
    getByLifeId(lifeId) { return personas.get(lifeId) },
    getAll() { return [...personas.values()] },
  }
}

function createConversationStore(): ConversationStore {
  return {
    append: vi.fn(),
    getRecent: vi.fn(() => []),
    clear: vi.fn(),
  }
}

function createModelGateway(): ModelGatewayService {
  return {
    execute: vi.fn(async () => ({ output: 'ok', messages: [] })),
  }
}

function createBrain(): BrainService {
  return {
    think: vi.fn(async () => ({ output: 'ok', messages: [], metadata: {} })),
  } as unknown as BrainService
}

function expectRuntimeContract(runtime: { service: unknown; dispose: () => void } | undefined) {
  expect(runtime).toBeTruthy()
  expect(runtime?.service).toBeTruthy()
  expect(typeof runtime?.dispose).toBe('function')
  expect(() => runtime?.dispose()).not.toThrow()
}

describe('Phase 42 internal factory contracts', () => {
  it('creates observatory runtime without Koishi context', () => {
    expectRuntimeContract(createObservatoryPluginRuntime({
      runtime: createRuntime(),
      config: { enabled: true, maxRecords: 10 },
      logger: createLogger(),
    }))
  })

  it('creates model-gateway runtime without Koishi context', () => {
    expectRuntimeContract(createModelGatewayPluginRuntime({
      runtime: createRuntime(),
      config: { slots: {}, defaultSlot: undefined } as any,
      logger: createLogger(),
    }))
  })

  it('creates brain runtime without Koishi context', () => {
    expectRuntimeContract(createBrainPluginRuntime({
      runtime: createRuntime(),
      modelGateway: createModelGateway(),
      config: {},
      logger: createLogger(),
    }))
  })

  it('creates dialogue runtime without Koishi context', () => {
    expectRuntimeContract(createDialoguePluginRuntime({
      runtime: { ...createRuntime(), conversationStore: createConversationStore() },
      brain: createBrain(),
      config: { enabled: true, memoryLimit: 5 },
      logger: createLogger(),
    }))
  })

  it('creates behavior runtime without Koishi context', () => {
    expectRuntimeContract(createBehaviorPluginRuntime({
      runtime: { ...createRuntime(), personaRegistry: createPersonaRegistry() },
      config: {
        enableReply: true,
        batcher: { quietWindowMs: 8_000, dmQuietWindowMs: 1_500, maxWaitMs: 30_000, densityWindowMs: 10_000, densityThreshold: 15, maxBatch: 50 },
        packMemory: { maxPacks: 12, injectPacks: 2 },
        commands: [],
        instantRules: [],
        triggers: { enabled: true, adminWhitelist: [], maxTasksPerOwner: 20, repository: 'memory' },
      },
      logger: createLogger(),
    }))
  })

  it('creates perception runtime without Koishi context', () => {
    expectRuntimeContract(createPerceptionPluginRuntime({
      runtime: createRuntime(),
      brain: createBrain(),
      config: {
        enabledIntentClassify: true,
        enabledEntityExtract: true,
        enabledSentiment: true,
      },
      logger: createLogger(),
    }))
  })

  it('creates cognition runtime without Koishi context', () => {
    expectRuntimeContract(createCognitionPluginRuntime({
      runtime: {
        ...createRuntime(),
        personaRegistry: createPersonaRegistry(),
        conversationStore: createConversationStore(),
      },
      brain: createBrain(),
      config: {
        events: {
          enabled: true,
          feed: { maxEvents: 30 },
          history: { maxEvents: 100, windowMs: 1_800_000 },
        },
      },
      logger: createLogger(),
    }))
  })

  it('creates homeostasis runtime without Koishi context', () => {
    const states = new Map<string, any>()
    const stateRepository: LifeStateRepository<any> = {
      getByLifeInstanceId: vi.fn(async (lifeId) => states.get(lifeId) ?? null),
      save: vi.fn(async (lifeId, state) => { states.set(lifeId, state) }),
    }
    const homeostasisService: HomeostasisService = {
      update: vi.fn(async () => ({ requestId: 'r', state: states.get('life')!, delta: {} as any, updated: true, reason: 'test' })),
      getState: vi.fn(async (lifeId) => states.get(lifeId)),
    }
    expectRuntimeContract(createHomeostasisPluginRuntime({
      runtime: {
        ...createRuntime(),
        stateRepository,
        homeostasisService,
        lifeRegistry: { getAll: () => [{ id: 'life' } as LifeInstance] },
      },
      config: {
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
      },
      logger: createLogger(),
    }))
  })

  it('creates persona runtime without Koishi context', () => {
    expectRuntimeContract(createPersonaPluginRuntime({
      runtime: { ...createRuntime(), personaRegistry: createPersonaRegistry() },
      config: {
        defaultName: 'Elysia',
        defaultSystemPrompt: 'You are Elysia.',
        defaultTone: 'gentle',
        registerDefaultPersona: false,
      },
      logger: createLogger(),
    }))
  })

  it('creates memory runtime without Koishi context', () => {
    expectRuntimeContract(createMemoryPluginRuntime({
      runtime: createRuntime(),
      config: { enabled: true, contextLimit: 5 },
      logger: createLogger(),
    }))
  })

  it('creates bond runtime without Koishi context', () => {
    expectRuntimeContract(createBondPluginRuntime({
      runtime: createRuntime(),
      config: { enabled: true, contextLimit: 5 },
      logger: createLogger(),
    }))
  })
})
