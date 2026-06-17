/**
 * D1 持久化生产化契约测试（裸 mongodb driver 形态）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md 第五章 D1）：
 * 旧 Mongo 仓储每次查询都 hydrate() 全表加载到内存再过滤，且 accessCount/
 * interactionCount 走应用层读-改-写。本测试立红线：
 *   D1-1 查询只按 lifeId/stimulusId 服务端缩小集合，不再全表加载
 *   D1-2 accessCount 用服务端 $inc 原子自增，并发不丢更新
 *   删除即时生效；重启（新仓储实例复用同集合）后数据可恢复
 *
 * 关键：本文件的 Fake 集合**忠实实现嵌套点路径 filter 与 $inc**，
 * 比 phase43 的简化 Fake 更接近真实 driver，能捕获"filter 被忽略→全表返回"的伪绿。
 */

import { describe, expect, it } from 'vitest'
import type { Bond, MemoryEntry } from '../packages/@elysia-ai/core/src/index.js'
import {
  MongoMemoryRepository,
  type MongoMemoryDocument,
} from '../packages/@elysia-ai/memory/src/index.js'
import {
  MongoBondRepository,
  type MongoBondDocument,
} from '../packages/@elysia-ai/bond/src/index.js'

/** 读取对象的嵌套点路径值，如 getPath(doc, 'entry.lifeId')。 */
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/** 设置对象的嵌套点路径值（用于 $inc / $set），按需创建中间对象。 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cursor = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

/**
 * 忠实 Mongo 集合 Fake：find/findOne 按 filter 每个键（含嵌套点路径）相等匹配并计数；
 * updateOne 支持 $set/$setOnInsert/$inc + upsert；deleteOne 真正删除。
 */
class FaithfulMongoCollection<TDoc extends { id: string }> {
  readonly documents = new Map<string, TDoc>()
  readonly indexes: Array<{ keys: Record<string, 1 | -1>; options?: Record<string, unknown> }> = []
  findCalls: Array<Record<string, unknown>> = []

  private matches(doc: TDoc, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => getPath(doc, key) === value)
  }

  async findOne(filter: Record<string, unknown>): Promise<TDoc | null> {
    for (const doc of this.documents.values()) {
      if (this.matches(doc, filter)) return doc
    }
    return null
  }

  find(filter: Record<string, unknown>): { toArray(): Promise<TDoc[]> } {
    this.findCalls.push(filter)
    const matched = [...this.documents.values()].filter((doc) => this.matches(doc, filter))
    return { toArray: async () => matched }
  }

  async updateOne(
    filter: { id: string } & Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    options: { upsert: boolean },
  ): Promise<unknown> {
    const id = String(filter.id)
    const existing = this.documents.get(id)
    if (!existing && !options.upsert) return { matchedCount: 0 }

    const base: Record<string, unknown> = existing
      ? structuredClone(existing)
      : { ...(update.$setOnInsert ?? {}) }

    for (const [key, value] of Object.entries(update.$set ?? {})) setPath(base, key, value)
    for (const [key, by] of Object.entries(update.$inc ?? {})) {
      const current = getPath(base, key)
      setPath(base, key, (typeof current === 'number' ? current : 0) + by)
    }

    this.documents.set(id, base as TDoc)
    return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 }
  }

  async deleteOne(filter: { id: string }): Promise<unknown> {
    const had = this.documents.delete(String(filter.id))
    return { deletedCount: had ? 1 : 0 }
  }

  async createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown> {
    this.indexes.push({ keys, options })
    return options?.name ?? 'idx'
  }
}

function createEntry(id: string, lifeId: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    lifeId,
    scope: 'life',
    kind: 'episodic',
    status: 'active',
    visibility: 'private',
    content: `content-${id}`,
    importance: 0.5,
    confidence: 0.8,
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function createBond(id: string, lifeId: string, targetId: string, overrides: Partial<Bond> = {}): Bond {
  return {
    id,
    lifeId,
    targetId,
    targetType: 'actor',
    status: 'active',
    metrics: { familiarity: 0.5, intimacy: 0.4, trust: 0.6, tension: 0.1, dependence: 0.2 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('D1-1 查询服务端缩小集合（不再全表 hydrate）', () => {
  it('memory.query 只 find 按 lifeId 缩小的子集，不全表加载', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A'))
    await repo.save(createEntry('m2', 'life-A'))
    await repo.save(createEntry('m3', 'life-B'))

    collection.findCalls = []
    const result = await repo.query({ lifeId: 'life-A' })

    expect(result.total).toBe(2)
    expect(result.entries.map((e) => e.id).sort()).toEqual(['m1', 'm2'])
    // 红线：必须带 lifeId 过滤，不得出现全表 find({})
    expect(collection.findCalls.length).toBeGreaterThan(0)
    for (const filter of collection.findCalls) {
      expect(filter).toHaveProperty('entry.lifeId', 'life-A')
    }
  })

  it('memory.listByStimulusId 按 stimulusId 服务端缩小', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { source: { stimulusId: 's1' } as never }))
    await repo.save(createEntry('m2', 'life-A', { source: { stimulusId: 's2' } as never }))

    collection.findCalls = []
    const found = await repo.listByStimulusId('s1')

    expect(found.map((e) => e.id)).toEqual(['m1'])
    for (const filter of collection.findCalls) {
      expect(filter).toHaveProperty('entry.source.stimulusId', 's1')
    }
  })

  it('memory.query 在子集上保留完整过滤语义（tags 大小写不敏感）', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { tags: ['Prod'] }))
    await repo.save(createEntry('m2', 'life-A', { tags: ['dev'] }))

    const result = await repo.query({ lifeId: 'life-A', tags: ['prod'] })
    expect(result.entries.map((e) => e.id)).toEqual(['m1'])
  })

  it('bond.query 只按 lifeId 缩小，且保留 targetType 归一化语义', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1', { targetType: 'actor' }))
    await repo.save(createBond('b2', 'life-B', 'actor-2'))

    collection.findCalls = []
    const result = await repo.query({ lifeId: 'life-A', targetType: 'individual' })

    // individual 归一化为 actor，应命中 b1
    expect(result.bonds.map((b) => b.id)).toEqual(['b1'])
    for (const filter of collection.findCalls) {
      expect(filter).toHaveProperty('bond.lifeId', 'life-A')
    }
  })

  it('bond.getByLifeAndTarget 用嵌套 bond.* 路径 findOne（修正 A-M5 形状不匹配）', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1'))

    const found = await repo.getByLifeAndTarget('life-A', 'actor-1', 'actor')
    expect(found?.id).toBe('b1')
  })
})

describe('D1-2 原子计数器（$inc，不丢并发更新）', () => {
  it('memory.incrementAccess 用 $inc 自增 accessCount 并落 lastAccessedAt', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { accessCount: 0 }))

    await repo.incrementAccess('m1', 5000)
    const after = await repo.getById('m1')
    expect(after?.accessCount).toBe(1)
    expect(after?.lastAccessedAt).toBe(5000)
  })

  it('并发自增不丢更新（10 次并发 → accessCount=10）', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { accessCount: 0 }))

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.incrementAccess('m1', 1000 + i)),
    )
    const after = await repo.getById('m1')
    expect(after?.accessCount).toBe(10)
  })
})

describe('D1 删除即时生效 + 重启恢复', () => {
  it('remove 软删后 query 不返回该条', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A'))
    await repo.save(createEntry('m2', 'life-A'))

    await repo.remove('m1')
    const result = await repo.query({ lifeId: 'life-A' })
    expect(result.entries.map((e) => e.id)).toEqual(['m2'])
  })

  it('重启（新仓储实例复用同集合）后数据可恢复', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo1 = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo1.save(createEntry('m1', 'life-A', { content: 'persisted' }))

    // 模拟进程重启：丢弃 repo1 的内存态，新实例复用同一底层集合
    const repo2 = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    const restored = await repo2.getById('m1')
    expect(restored?.content).toBe('persisted')
    const queried = await repo2.query({ lifeId: 'life-A' })
    expect(queried.total).toBe(1)
  })
})
