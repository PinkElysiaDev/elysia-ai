
import { describe, expect, it, vi } from 'vitest'
import { asCordisContext, type Context } from 'koishi'
import { MemoryEventBus, type CoreEventMap, type MemoryEntry, type Bond } from '../packages/@elysia-ai/core/src/index.js'
import { applyFindOptions, matchesFilter, type MongoFakeFindOptions } from './helpers/mongo-fake.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { apply as applyMemory } from '../packages/elysia-ai-memory/src/index.js'
import { apply as applyBond } from '../packages/elysia-ai-bond/src/index.js'
import { MemoryMemoryRepository, MongoMemoryRepository, type MongoMemoryDocument } from '../packages/@elysia-ai/memory/src/index.js'
import { MemoryBondRepository, MongoBondRepository, type MongoBondDocument } from '../packages/@elysia-ai/bond/src/index.js'
import { DefaultModelGatewayService } from '../packages/@elysia-ai/model-gateway/src/index.js'
import { apply as applyModelGateway } from '../packages/elysia-ai-model-gateway/src/index.js'
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
  return { ctx: asCordisContext(ctx) as Context & Record<string, any>, disposers }
}

class FakeMongoCollection<TDocument extends { id: string }> {
  readonly documents = new Map<string, TDocument>()
  readonly indexes: Array<{ keys: Record<string, 1 | -1>; options?: Record<string, unknown> }> = []

  async findOne(filter: Record<string, unknown>): Promise<TDocument | null> {
    for (const document of this.documents.values()) {
      if (matchesFilter(document, filter)) return document
    }
    return null
  }

  find(filter: Record<string, unknown>, options?: MongoFakeFindOptions): { toArray(): Promise<TDocument[]> } {
    return { toArray: async () => applyFindOptions([...this.documents.values()].filter((d) => matchesFilter(d, filter)), options) }
  }

  async updateOne(filter: { id: string }, update: { $set: Partial<TDocument>; $setOnInsert: Partial<TDocument> }, _options: { upsert: true }) {
    this.documents.set(filter.id, {
      ...update.$setOnInsert,
      ...update.$set,
    } as TDocument)
  }

  async createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>) {
    this.indexes.push({ keys, options })
  }
}

function createMemoryEntry(id: string): MemoryEntry {
  return {
    id,
    lifeId: 'life-prod',
    scope: 'life',
    kind: 'episodic',
    status: 'active',
    visibility: 'private',
    content: 'remembers production repository',
    importance: 0.8,
    confidence: 0.9,
    tags: ['prod'],
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function createBond(id: string): Bond {
  return {
    id,
    lifeId: 'life-prod',
    targetId: 'actor-prod',
    targetType: 'actor',
    status: 'active',
    metrics: { familiarity: 0.5, intimacy: 0.4, trust: 0.6, tension: 0.1, dependence: 0.2 },
    createdAt: 1000,
    updatedAt: 1000,
  }
}

describe('Phase 43 production repository/provider configuration', () => {
  it('MongoMemoryRepository satisfies MemoryRepository operations with a Mongo-compatible collection', async () => {
    const collection = new FakeMongoCollection<MongoMemoryDocument>()
    const repository = new MongoMemoryRepository(collection, { collectionName: 'phase43_memories' })
    await repository.ensureIndexes()

    const entry = createMemoryEntry('memory-prod-1')
    await repository.save(entry)
    await repository.update(entry.id, { summary: 'updated summary', tags: ['prod', 'updated'] })

    const stored = await repository.getById(entry.id)
    const query = await repository.query({ lifeId: 'life-prod', tags: ['updated'] })
    const byLife = await repository.listByLifeId('life-prod')
    const byStimulus = await repository.listByStimulusId('missing-stimulus')

    expect(collection.indexes.length).toBeGreaterThan(0)
    expect(stored?.summary).toBe('updated summary')
    expect(query.total).toBe(1)
    expect(byLife).toHaveLength(1)
    expect(byStimulus).toHaveLength(0)
  })

  it('MongoBondRepository satisfies BondRepository operations with a Mongo-compatible collection', async () => {
    const collection = new FakeMongoCollection<MongoBondDocument>()
    const repository = new MongoBondRepository(collection, { collectionName: 'phase43_bonds' })
    await repository.ensureIndexes()

    const bond = createBond('bond-prod-1')
    await repository.save(bond)
    await repository.update(bond.id, { summary: 'trusted actor', tags: ['prod'] })

    const stored = await repository.getByLifeAndTarget('life-prod', 'actor-prod', 'actor')
    const query = await repository.query({ lifeId: 'life-prod', targetId: 'actor-prod' })
    const byLife = await repository.listByLife('life-prod')

    expect(collection.indexes.length).toBeGreaterThan(0)
    expect(stored?.summary).toBe('trusted actor')
    expect(query.total).toBe(1)
    expect(byLife).toHaveLength(1)
  })

  it('top-level memory and bond fall back to in-memory repositories when mongo persistence is unavailable', () => {
    const { ctx } = createPluginContext()
    const runtime = createDefaultRuntime()
    ctx['elysia.runtime'] = runtime

    // 旧契约（repository.type='mongo' 无 repositoryFactory 即 fail fast）已随 elysia.persistence
    // 架构移除：mongo 连接由 runtime 统一建立并经 elysia.persistence 提供；服务缺失时回退内存仓储。
    applyMemory(ctx, { enabled: true, contextLimit: 5 } as any)
    expect(ctx['elysia.memory']).toBeTruthy()
    expect(ctx['elysia.memory'].repository).toBeInstanceOf(MemoryMemoryRepository)

    applyBond(ctx, { enabled: true, contextLimit: 5 } as any)
    expect(ctx['elysia.bond']).toBeTruthy()
    expect(ctx['elysia.bond'].repository).toBeInstanceOf(MemoryBondRepository)
  })

  it('top-level memory and bond accept injected repository factories for production providers', () => {
    const { ctx } = createPluginContext()
    const runtime = createDefaultRuntime()
    ctx['elysia.runtime'] = runtime
    const memoryCollection = new FakeMongoCollection<MongoMemoryDocument>()
    const bondCollection = new FakeMongoCollection<MongoBondDocument>()

    applyMemory(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo', mongo: { collectionName: 'phase43_memories' } },
      repositoryFactory: () => new MongoMemoryRepository(memoryCollection),
    } as any)
    applyBond(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo', mongo: { collectionName: 'phase43_bonds' } },
      repositoryFactory: () => new MongoBondRepository(bondCollection),
    } as any)

    expect(ctx['elysia.memory']?.repository).toBeInstanceOf(MongoMemoryRepository)
    expect(ctx['elysia.bond']?.repository).toBeInstanceOf(MongoBondRepository)
  })

  it('model gateway supports provider registry config with direct apiKey and provider slots', () => {
    const gateway = new DefaultModelGatewayService({
      providers: {
        primary: { type: 'chat-completions', model: 'gpt-4.1-mini', apiKey: 'phase43-secret', baseURL: 'https://phase43.example' },
      },
      providerSlots: {
        chat: { provider: 'primary', model: 'gpt-4.1' },
      },
      defaultSlot: 'chat',
    })

    const provider = gateway.getRegistry().resolveSlot('chat')
    expect(provider?.id).toBe('slot:chat')
    expect(provider?.descriptor).toMatchObject({ type: 'chat-completions', model: 'gpt-4.1' })
  })

  it('model gateway fails fast for missing apiKey without leaking secret values', () => {
    const { ctx } = createPluginContext()
    const runtime = createDefaultRuntime()
    ctx['elysia.runtime'] = runtime

    expect(() => applyModelGateway(ctx, {
      providers: {
        primary: { type: 'chat-completions', model: 'gpt-4.1-mini', apiKey: '', baseURL: 'https://phase43.example' },
      },
      providerSlots: { chat: { provider: 'primary' } },
      defaultSlot: 'chat',
    } as any)).toThrow(/requires apiKey/)
    expect(ctx['elysia.modelGateway']).toBeUndefined()
  })

  it('observatory can query repository diagnostics by component and repositoryType', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const observatory = createObservatoryPluginRuntime({
      runtime: { context: { eventBus } },
      config: { maxRecords: 20 },
      logger: createLogger(),
    })!

    await eventBus.emit('repository.initialized', {
      component: 'memory',
      repositoryType: 'mongo',
      collectionName: 'phase43_memories',
    })

    const records = observatory.service.queryEvents({ component: 'memory', repositoryType: 'mongo' } as any)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'repository', status: 'initialized' })
    observatory.dispose()
  })
})
