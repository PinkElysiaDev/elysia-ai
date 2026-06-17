
import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'koishi'
import { MemoryEventBus, type Bond, type CoreEventMap, type MemoryEntry } from '../packages/@elysia-ai/core/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import {
  apply as applyMemory,
  createMongoMemoryRepositoryFactory,
  validateMemoryRepositoryConfig,
} from '../packages/elysia-ai-memory/src/index.js'
import {
  apply as applyBond,
  createMongoBondRepositoryFactory,
  validateBondRepositoryConfig,
} from '../packages/elysia-ai-bond/src/index.js'
import {
  apply as applyModelGateway,
  validateModelGatewayConfig,
} from '../packages/elysia-ai-model-gateway/src/index.js'
import type { MongoMemoryDocument } from '../packages/@elysia-ai/memory/src/index.js'
import { MongoMemoryRepository } from '../packages/@elysia-ai/memory/src/index.js'
import type { MongoBondDocument } from '../packages/@elysia-ai/bond/src/index.js'
import { MongoBondRepository } from '../packages/@elysia-ai/bond/src/index.js'
import { createObservatoryPluginRuntime } from '../packages/@elysia-ai/observatory/src/index.js'

function createLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
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

class FakeMongoCollection<TDocument extends { id: string }> {
  readonly documents = new Map<string, TDocument>()
  readonly indexes: Array<{ keys: Record<string, 1 | -1>; options?: Record<string, unknown> }> = []
  closed = false

  async findOne(filter: Record<string, unknown>): Promise<TDocument | null> {
    if (filter.id) return this.documents.get(String(filter.id)) ?? null
    for (const document of this.documents.values()) {
      const payload = (document as any).entry ?? (document as any).bond
      if (filter.lifeId && payload.lifeId !== filter.lifeId) continue
      if (filter.targetId && payload.targetId !== filter.targetId) continue
      if (filter.targetType && payload.targetType !== filter.targetType) continue
      return document
    }
    return null
  }

  find(): { toArray(): Promise<TDocument[]> } {
    return { toArray: async () => [...this.documents.values()] }
  }

  async updateOne(filter: { id: string }, update: { $set: Partial<TDocument>; $setOnInsert: Partial<TDocument> }, _options: { upsert: true }) {
    this.documents.set(filter.id, { ...update.$setOnInsert, ...update.$set } as TDocument)
  }

  async createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>) {
    this.indexes.push({ keys, options })
  }

  async close() {
    this.closed = true
  }
}

function createMemoryEntry(id: string): MemoryEntry {
  return {
    id,
    lifeId: 'life-phase44',
    scope: 'life',
    kind: 'episodic',
    status: 'active',
    visibility: 'private',
    content: 'phase44 memory',
    importance: 0.7,
    confidence: 0.9,
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function createBond(id: string): Bond {
  return {
    id,
    lifeId: 'life-phase44',
    targetId: 'actor-phase44',
    targetType: 'actor',
    status: 'active',
    metrics: { familiarity: 0.5, intimacy: 0.4, trust: 0.6, tension: 0.1, dependence: 0.2 },
    createdAt: 1000,
    updatedAt: 1000,
  }
}

describe('Phase 44 production readiness gates', () => {
  it('mongo repository helpers create repositories, initialize indexes, and leave external collection lifecycle untouched', async () => {
    const memoryCollection = new FakeMongoCollection<MongoMemoryDocument>()
    const bondCollection = new FakeMongoCollection<MongoBondDocument>()
    const memoryFactory = createMongoMemoryRepositoryFactory(memoryCollection, { collectionName: 'phase44_memories' })
    const bondFactory = createMongoBondRepositoryFactory(bondCollection, { collectionName: 'phase44_bonds' })

    const memoryRepository = memoryFactory({ config: { enabled: true, contextLimit: 5 }, logger: createLogger() })
    const bondRepository = bondFactory({ config: { enabled: true, contextLimit: 5 }, logger: createLogger() })

    expect(memoryRepository).toBeInstanceOf(MongoMemoryRepository)
    expect(bondRepository).toBeInstanceOf(MongoBondRepository)
    await Promise.resolve()
    expect(memoryCollection.indexes.length).toBeGreaterThan(0)
    expect(bondCollection.indexes.length).toBeGreaterThan(0)

    await memoryRepository.save(createMemoryEntry('memory-phase44'))
    await bondRepository.save(createBond('bond-phase44'))
    expect((await memoryRepository.query({ lifeId: 'life-phase44' })).total).toBe(1)
    expect((await bondRepository.query({ lifeId: 'life-phase44' })).total).toBe(1)
    expect(memoryCollection.closed).toBe(false)
    expect(bondCollection.closed).toBe(false)
  })

  it('top-level plugins accept helper factories and dispose without closing external collections', async () => {
    const { ctx, disposers } = createPluginContext()
    const runtime = createDefaultRuntime()
    const memoryCollection = new FakeMongoCollection<MongoMemoryDocument>()
    const bondCollection = new FakeMongoCollection<MongoBondDocument>()
    ctx['elysia.runtime'] = runtime

    applyMemory(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo' },
      repositoryFactory: createMongoMemoryRepositoryFactory(memoryCollection),
    } as any)
    applyBond(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo' },
      repositoryFactory: createMongoBondRepositoryFactory(bondCollection),
    } as any)

    expect(ctx['elysia.memory'].repository).toBeInstanceOf(MongoMemoryRepository)
    expect(ctx['elysia.bond'].repository).toBeInstanceOf(MongoBondRepository)
    for (const dispose of disposers) await dispose()
    expect(memoryCollection.closed).toBe(false)
    expect(bondCollection.closed).toBe(false)
  })

  it('repository validation exposes stable fail-fast errors', () => {
    expect(() => validateMemoryRepositoryConfig({ enabled: true, contextLimit: 5, repository: { type: 'mongo' } } as any)).toThrow(/repositoryFactory/)
    expect(() => validateBondRepositoryConfig({ enabled: true, contextLimit: 5, repository: { type: 'mongo' } } as any)).toThrow(/repositoryFactory/)
    expect(() => validateMemoryRepositoryConfig({ enabled: true, contextLimit: 5, repository: { type: 'memory' } } as any)).not.toThrow()
    expect(() => validateBondRepositoryConfig({ enabled: true, contextLimit: 5, repository: { type: 'memory' } } as any)).not.toThrow()
  })

  it('model-gateway validation catches production config errors without leaking secret values', () => {
    expect(() => validateModelGatewayConfig({
      providers: { primary: { type: 'unknown' as any, model: 'secret-model', apiKey: 'sk-secret-value' } },
    })).toThrow(/provider "primary" has unknown type/)

    expect(() => validateModelGatewayConfig({
      providers: { primary: { type: 'openai', model: 'gpt-4.1-mini' } },
    })).toThrow(/requires apiKey or apiKeyEnv/)

    expect(() => validateModelGatewayConfig({
      providers: { primary: { type: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-secret-value' } },
      providerSlots: { chat: { provider: 'missing' } },
    })).toThrow(/unknown provider "missing"/)

    expect(() => validateModelGatewayConfig({
      providers: { primary: { type: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-secret-value' } },
      providerSlots: { chat: { provider: 'primary' } },
      fallback: { enabled: true, slots: { chat: ['missing-fallback'] } },
    })).toThrow(/fallback slot "missing-fallback"/)

    try {
      validateModelGatewayConfig({
        providers: { primary: { type: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-secret-value' } },
        providerSlots: { chat: { provider: 'missing' } },
      })
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret-value')
    }
  })

  it('model-gateway apply runs validation before service registration', () => {
    const { ctx } = createPluginContext()
    ctx['elysia.runtime'] = createDefaultRuntime()

    expect(() => applyModelGateway(ctx, {
      providers: { primary: { type: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-secret-value' } },
      providerSlots: { chat: { provider: 'missing' } },
    } as any)).toThrow(/unknown provider "missing"/)
    expect(ctx['elysia.modelGateway']).toBeUndefined()
  })

  it('observatory snapshot includes repository analytics without removing gateway analytics', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const observatory = createObservatoryPluginRuntime({
      runtime: { context: { eventBus } },
      config: { maxRecords: 20 },
      logger: createLogger(),
    })!

    await eventBus.emit('repository.initialized', { component: 'memory', repositoryType: 'mongo' })
    await eventBus.emit('repository.fallback-to-memory', { component: 'bond', repositoryType: 'memory', reason: 'default-in-memory-repository' })
    await eventBus.emit('repository.query.failed', { component: 'memory', repositoryType: 'mongo', operation: 'query', error: new Error('query failed') })
    await eventBus.emit('repository.write.failed', { component: 'bond', repositoryType: 'mongo', operation: 'save', error: new Error('write failed') })

    const analytics = observatory.service.service.getRepositoryAnalytics()
    const snapshot = observatory.service.service.getSnapshot()

    expect(analytics).toMatchObject({
      totalRepositoryEvents: 4,
      initializedCount: 1,
      fallbackCount: 1,
      queryFailureCount: 1,
      writeFailureCount: 1,
      byComponent: { memory: 2, bond: 2 },
      byRepositoryType: { mongo: 3, memory: 1 },
    })
    expect(snapshot.repositoryAnalytics).toEqual(analytics)
    expect(snapshot.gatewayAnalytics).toBeTruthy()
    observatory.dispose()
  })
})
