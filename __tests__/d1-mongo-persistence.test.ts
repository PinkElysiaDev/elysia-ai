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
  DefaultMemoryService,
  MongoMemoryRepository,
  type MongoMemoryDocument,
} from '../packages/@elysia-ai/memory/src/index.js'
import {
  MongoBondRepository,
  type MongoBondDocument,
} from '../packages/@elysia-ai/bond/src/index.js'
import { FaithfulMongoCollection } from './helpers/mongo-fake.js'

/**
 * 忠实 Mongo 集合 Fake 已抽至 __tests__/helpers/mongo-fake.ts 共享：
 * find/findOne 走通用 matchesFilter（点路径 + $ne/$in/$gte/$lte/$or/$elemMatch），
 * find 支持 options（sort/limit/skip），countDocuments 服务端计数。
 */

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
  it('memory.query 全维度下推：filter 含 status $ne deleted，sort/limit/skip 直达服务端', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A'))
    await repo.save(createEntry('m2', 'life-A'))
    await repo.save(createEntry('m3', 'life-B'))

    collection.findCalls = []
    collection.findOptions = []
    const result = await repo.query({ lifeId: 'life-A' })

    expect(result.total).toBe(2)
    expect(result.entries.map((e) => e.id).sort()).toEqual(['m1', 'm2'])
    // 红线：必须带 lifeId 过滤，不得出现全表 find({})
    expect(collection.findCalls.length).toBeGreaterThan(0)
    for (const filter of collection.findCalls) {
      expect(filter).toHaveProperty('entry.lifeId', 'life-A')
    }
    // 【B2】形状：默认排除 deleted（includeDeleted 未设），默认 createdAt 倒序
    expect(collection.findCalls[0]).toEqual({
      'entry.lifeId': 'life-A',
      'entry.status': { $ne: 'deleted' },
    })
    expect(collection.findOptions[0]).toEqual({ sort: { 'entry.createdAt': -1 } })
  })

  it('memory.listByStimulusId 按 stimulusId 服务端缩小（含 status $ne deleted 与 createdAt 倒序下推）', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { source: { stimulusId: 's1' } as never }))
    await repo.save(createEntry('m2', 'life-A', { source: { stimulusId: 's2' } as never }))
    await repo.save(createEntry('m3', 'life-B', { source: { stimulusId: 's1' } as never, createdAt: 2000 }))

    collection.findCalls = []
    collection.findOptions = []
    const found = await repo.listByStimulusId('s1')

    // 内存版语义：跨 life（m3 也命中）、排除 deleted、createdAt 倒序
    expect(found.map((e) => e.id)).toEqual(['m3', 'm1'])
    expect(collection.findCalls[0]).toEqual({
      'entry.source.stimulusId': 's1',
      'entry.status': { $ne: 'deleted' },
    })
    expect(collection.findOptions[0]).toEqual({ sort: { 'entry.createdAt': -1 } })
  })

  it('memory.query 在下推结果上保留完整过滤语义（tags 大小写不敏感 ALL，不下推）', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { tags: ['Prod'] }))
    await repo.save(createEntry('m2', 'life-A', { tags: ['dev'] }))

    collection.findCalls = []
    const result = await repo.query({ lifeId: 'life-A', tags: ['prod'] })
    expect(result.entries.map((e) => e.id)).toEqual(['m1'])
    // tags 不出现在下推 filter 中（大小写不敏感 ALL 语义留在内存精滤）
    expect(collection.findCalls[0]).not.toHaveProperty('entry.tags')
  })

  it('bond.query 下推：status $ne deleted + targetType $in 等值（无别名展开）', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1', { targetType: 'actor' }))
    await repo.save(createBond('b2', 'life-B', 'actor-2'))
    await repo.save(createBond('b3', 'life-A', 'actor-3', { targetType: 'habitat' }))
    await repo.save(createBond('b4', 'life-A', 'actor-4', { targetType: 'external' }))

    collection.findCalls = []
    collection.findOptions = []
    const result = await repo.query({ lifeId: 'life-A', targetType: ['actor', 'habitat'] })

    // 多类型 $in 等值命中：b1（actor）与 b3（habitat）；b4 external 不命中
    expect(result.bonds.map((b) => b.id).sort()).toEqual(['b1', 'b3'])
    expect(collection.findCalls[0]).toEqual({
      'bond.lifeId': 'life-A',
      'bond.status': { $ne: 'deleted' },
      'bond.targetType': { $in: ['actor', 'habitat'] },
    })
    expect(collection.findOptions[0]).toEqual({ sort: { 'bond.updatedAt': -1 } })
  })

  it('bond.getByLifeAndTarget 单次 findOne 直查（status $ne deleted + targetType 等值）', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1'))
    await repo.save(createBond('b-deleted', 'life-A', 'actor-9', { status: 'deleted' }))

    collection.findOneCalls = []
    const found = await repo.getByLifeAndTarget('life-A', 'actor-1', 'actor')
    expect(found?.id).toBe('b1')
    expect(collection.findOneCalls[0]).toEqual({
      'bond.lifeId': 'life-A',
      'bond.targetId': 'actor-1',
      'bond.status': { $ne: 'deleted' },
      'bond.targetType': 'actor',
    })

    // deleted 的 bond 不被 findOne 命中（不再有全拉回退分支）
    expect(await repo.getByLifeAndTarget('life-A', 'actor-9')).toBeUndefined()
    // 无类型约束时不加 targetType 键
    collection.findOneCalls = []
    expect((await repo.getByLifeAndTarget('life-A', 'actor-1'))?.id).toBe('b1')
    expect(collection.findOneCalls[0]).not.toHaveProperty('bond.targetType')
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

describe('B2 memory 查询下推语义等价（owner/text/tags/relations/范围/窗口）', () => {
  it('owner 查询：等值 + $in 下推，importance 倒序窗口，archived/异 owner/异 life 排除', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A', { ownerType: 'actor', ownerId: 'u1', visibility: 'private', importance: 0.9, createdAt: 1000 }))
    await repo.save(createEntry('m2', 'life-A', { ownerType: 'actor', ownerId: 'u1', visibility: 'private', importance: 0.4, createdAt: 2000 }))
    await repo.save(createEntry('m3', 'life-A', { ownerType: 'actor', ownerId: 'u2', visibility: 'private', importance: 0.95, createdAt: 3000 }))
    await repo.save(createEntry('m4', 'life-A', { ownerType: 'actor', ownerId: 'u1', visibility: 'shared', importance: 0.8, createdAt: 4000 }))
    await repo.save(createEntry('m5', 'life-A', { ownerType: 'actor', ownerId: 'u1', visibility: 'private', importance: 0.7, status: 'archived', createdAt: 5000 }))
    await repo.save(createEntry('m6', 'life-B', { ownerType: 'actor', ownerId: 'u1', visibility: 'private', importance: 0.99, createdAt: 6000 }))

    collection.findCalls = []
    collection.findOptions = []
    const result = await repo.query({
      lifeId: 'life-A',
      ownerType: 'actor',
      ownerId: 'u1',
      visibility: ['private', 'shared'],
      status: 'active',
      orderBy: 'importance',
      order: 'desc',
      limit: 2,
    })

    // 语义等价：importance 降序窗口 [m1(0.9), m4(0.8)]；m5 archived、m6 异 life、m3 异 owner、m2 排窗外
    expect(result.entries.map((e) => e.id)).toEqual(['m1', 'm4'])
    expect(result.total).toBe(2)
    expect(collection.findCalls).toEqual([{
      'entry.lifeId': 'life-A',
      'entry.status': { $in: ['active'] },
      'entry.ownerType': { $in: ['actor'] },
      'entry.ownerId': 'u1',
      'entry.visibility': { $in: ['private', 'shared'] },
    }])
    expect(collection.findOptions[0]).toEqual({
      sort: { 'entry.importance': -1, 'entry.createdAt': -1 },
      limit: 2,
    })
  })

  it('text 查询：子串不下推，limit 放大 3 倍后内存精滤再截断', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    // 高 importance 的两条不含 needle（不放大就会挤掉全部命中），四条命中
    await repo.save(createEntry('miss-top', 'life-A', { content: 'unrelated alpha', importance: 0.9, createdAt: 1000 }))
    await repo.save(createEntry('miss-2nd', 'life-A', { content: 'unrelated beta', importance: 0.8, createdAt: 2000 }))
    await repo.save(createEntry('hit-1', 'life-A', { content: 'contains NeEdLe one', importance: 0.7, createdAt: 3000 }))
    await repo.save(createEntry('hit-2', 'life-A', { summary: 'needle in summary', importance: 0.6, createdAt: 4000 }))
    await repo.save(createEntry('hit-3', 'life-A', { content: 'needle three', importance: 0.5, createdAt: 5000 }))
    await repo.save(createEntry('hit-4', 'life-A', { content: 'needle four', importance: 0.4, createdAt: 6000 }))
    await repo.save(createEntry('miss-life', 'life-B', { content: 'needle elsewhere', importance: 0.99, createdAt: 7000 }))

    collection.findCalls = []
    collection.findOptions = []
    const result = await repo.query({
      lifeId: 'life-A',
      text: 'needle',
      status: 'active',
      orderBy: 'importance',
      order: 'desc',
      limit: 2,
    })

    // 放大 3x（limit 2 → fetch 6）足以覆盖 2 条未命中后仍取到前 2 条命中（大小写不敏感）
    expect(result.entries.map((e) => e.id)).toEqual(['hit-1', 'hit-2'])
    expect(result.total).toBe(4)
    expect(collection.findCalls[0]).not.toHaveProperty('text')
    expect(collection.findOptions[0]).toEqual({
      sort: { 'entry.importance': -1, 'entry.createdAt': -1 },
      limit: 6,
    })
  })

  it('tags 查询：大小写不敏感 ALL 语义在内存精滤保留（多标签缺一不可）', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('t1', 'life-A', { tags: ['Prod', 'CORE'] }))
    await repo.save(createEntry('t2', 'life-A', { tags: ['prod'] }))
    await repo.save(createEntry('t3', 'life-A', { tags: ['Prod', 'other'] }))

    const result = await repo.query({ lifeId: 'life-A', tags: ['prod', 'core'] })
    expect(result.entries.map((e) => e.id)).toEqual(['t1'])
  })

  it('relations 查询：$elemMatch 精确下推', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    const relation = (targetType: string, targetId: string, role: string) => ({
      targetType, targetId, role, confidence: 1,
    } as never)
    await repo.save(createEntry('r1', 'life-A', { relations: [relation('actor', 'a-1', 'subject')] }))
    await repo.save(createEntry('r2', 'life-A', { relations: [relation('actor', 'a-2', 'subject')] }))
    await repo.save(createEntry('r3', 'life-A', { relations: [relation('habitat', 'a-1', 'location')] }))
    await repo.save(createEntry('r4', 'life-A', { relations: [relation('actor', 'a-1', 'participant'), relation('thread', 't-9', 'source')] }))

    collection.findCalls = []
    const byTarget = await repo.query({ lifeId: 'life-A', relationTargetType: 'actor', relationTargetId: 'a-1' })
    expect(byTarget.entries.map((e) => e.id).sort()).toEqual(['r1', 'r4'])
    expect(collection.findCalls[0]).toEqual({
      'entry.lifeId': 'life-A',
      'entry.status': { $ne: 'deleted' },
      'entry.relations': { $elemMatch: { targetType: 'actor', targetId: 'a-1' } },
    })

    collection.findCalls = []
    const byRole = await repo.query({ lifeId: 'life-A', relationRole: 'participant' })
    expect(byRole.entries.map((e) => e.id)).toEqual(['r4'])
    expect(collection.findCalls[0]['entry.relations']).toEqual({ $elemMatch: { role: 'participant' } })
  })

  it('minImportance/createdAfter/createdBefore 范围下推 + createdAt 升序 offset 窗口', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    for (let i = 1; i <= 5; i += 1) {
      await repo.save(createEntry(`m${i}`, 'life-A', {
        importance: i * 0.1,
        createdAt: i * 1000,
        updatedAt: i * 1000,
      }))
    }

    collection.findCalls = []
    collection.findOptions = []
    const ranged = await repo.query({ lifeId: 'life-A', minImportance: 0.25, createdAfter: 1500, createdBefore: 4500 })
    expect(collection.findCalls[0]).toEqual({
      'entry.lifeId': 'life-A',
      'entry.status': { $ne: 'deleted' },
      'entry.importance': { $gte: 0.25 },
      'entry.createdAt': { $gte: 1500, $lte: 4500 },
    })
    // 默认 createdAt 倒序：m4 先于 m3
    expect(ranged.entries.map((e) => e.id)).toEqual(['m4', 'm3'])

    collection.findCalls = []
    collection.findOptions = []
    const window = await repo.query({ lifeId: 'life-A', orderBy: 'createdAt', order: 'asc', limit: 2, offset: 1 })
    expect(window.entries.map((e) => e.id)).toEqual(['m2', 'm3'])
    expect(collection.findOptions[0]).toEqual({ sort: { 'entry.createdAt': 1 }, limit: 3 })
  })

  it('includeDeleted 时不下推状态键；status 数组按 $in 下推', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    await repo.save(createEntry('m1', 'life-A'))
    await repo.save(createEntry('m2', 'life-A', { status: 'archived' }))
    await repo.save(createEntry('m3', 'life-A', { status: 'deleted' }))

    collection.findCalls = []
    const all = await repo.query({ lifeId: 'life-A', includeDeleted: true })
    expect(all.entries.map((e) => e.id).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(collection.findCalls[0]).toEqual({ 'entry.lifeId': 'life-A' })

    collection.findCalls = []
    const archivedOnly = await repo.query({ lifeId: 'life-A', status: ['archived', 'deleted'] })
    // includeDeleted 未设：即便 statuses 含 deleted，$ne 兜底仍排除之（内存版语义）
    expect(archivedOnly.entries.map((e) => e.id)).toEqual(['m2'])
    expect(collection.findCalls[0]['entry.status']).toEqual({ $in: ['archived', 'deleted'], $ne: 'deleted' })

    collection.findCalls = []
    const includeDeletedWithStatus = await repo.query({ lifeId: 'life-A', includeDeleted: true, status: ['archived', 'deleted'] })
    expect(includeDeletedWithStatus.entries.map((e) => e.id).sort()).toEqual(['m2', 'm3'])
    expect(collection.findCalls[0]['entry.status']).toEqual({ $in: ['archived', 'deleted'] })
  })
})

describe('B3 enforceMaxEntries 计数化（countDocuments + 溢出集直查）', () => {
  function makeService(collection: FaithfulMongoCollection<MongoMemoryDocument>, maxEntriesPerLife: number) {
    const repo = new MongoMemoryRepository(collection as never, { collectionName: 'd1_mem' })
    const eventBus = { on: () => () => {}, emit: async () => {} } as never
    return {
      repo,
      service: new DefaultMemoryService(repo, eventBus, undefined, { maxEntriesPerLife }),
    }
  }

  it('超限时：先 countDocuments，再只拉 count-max 条溢出集归档', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const { repo, service } = makeService(collection, 3)
    await repo.save(createEntry('important', 'life-A', { importance: 0.9, createdAt: 1000 }))
    await repo.save(createEntry('boring', 'life-A', { importance: 0.2, createdAt: 2000 }))
    await repo.save(createEntry('middle', 'life-A', { importance: 0.5, createdAt: 3000 }))
    await repo.save(createEntry('already-archived', 'life-A', { importance: 0.1, status: 'archived', createdAt: 4000 }))

    collection.findCalls = []
    collection.findOptions = []
    collection.countCalls = []
    await service.update({ id: 'req-1', lifeId: 'life-A', content: 'new entry', skipAttribution: true } as never)

    // countDocuments 以 (lifeId, active) 计数（archived 不占上限）
    expect(collection.countCalls.at(-1)).toEqual({ 'entry.lifeId': 'life-A', 'entry.status': 'active' })
    // 溢出集直查：仅拉 4-3=1 条，(importance asc, createdAt asc) 序
    const overflowIndex = collection.findOptions.findIndex((options) => options?.sort?.['entry.importance'] === 1)
    expect(overflowIndex).toBeGreaterThanOrEqual(0)
    expect(collection.findOptions[overflowIndex]).toEqual({
      sort: { 'entry.importance': 1, 'entry.createdAt': 1 },
      limit: 1,
    })
    expect(collection.findCalls[overflowIndex]).toEqual({ 'entry.lifeId': 'life-A', 'entry.status': 'active' })

    // 最不重要的 active（boring）被归档；already-archived 不再被触碰
    expect((await repo.getById('boring'))?.status).toBe('archived')
    expect((await repo.getById('important'))?.status).toBe('active')
    expect((await repo.getById('middle'))?.status).toBe('active')
    const archived = await repo.getById('already-archived')
    expect(archived?.status).toBe('archived')
    expect(archived?.metadata).toBeUndefined()
    // 新建条目本身保留 active；active 总数回到上限 3
    expect((await repo.query({ lifeId: 'life-A', status: 'active' })).total).toBe(3)
  })

  it('未超限时：只 count，不发生溢出集 find', async () => {
    const collection = new FaithfulMongoCollection<MongoMemoryDocument>()
    const { repo, service } = makeService(collection, 10)
    await repo.save(createEntry('only', 'life-A'))

    collection.findCalls = []
    collection.findOptions = []
    collection.countCalls = []
    await service.update({ id: 'req-2', lifeId: 'life-A', content: 'another', skipAttribution: true } as never)

    expect(collection.countCalls.at(-1)).toEqual({ 'entry.lifeId': 'life-A', 'entry.status': 'active' })
    expect(collection.findOptions.some((options) => options?.sort?.['entry.importance'] === 1)).toBe(false)
  })
})

describe('C bond 查询下推语义等价（指标范围/排序/窗口/tags 精滤）', () => {
  it('minFamiliarity/updatedAfter/updatedBefore 下推 + interactionCount 倒序窗口', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    const metrics = (familiarity: number) => ({ familiarity, intimacy: 0.4, trust: 0.6, tension: 0.1, dependence: 0.2 })
    await repo.save(createBond('b1', 'life-A', 'actor-1', { metrics: metrics(0.9), interactionCount: 10, updatedAt: 5000 }))
    await repo.save(createBond('b2', 'life-A', 'actor-2', { metrics: metrics(0.7), interactionCount: 30, updatedAt: 6000 }))
    await repo.save(createBond('b3', 'life-A', 'actor-3', { metrics: metrics(0.5), interactionCount: 20, updatedAt: 7000 }))
    await repo.save(createBond('b4', 'life-A', 'actor-4', { metrics: metrics(0.95), status: 'archived', interactionCount: 99, updatedAt: 8000 }))
    await repo.save(createBond('b5', 'life-B', 'actor-1', { metrics: metrics(0.99), interactionCount: 999, updatedAt: 9000 }))

    collection.findCalls = []
    collection.findOptions = []
    const result = await repo.query({
      lifeId: 'life-A',
      status: 'active',
      minFamiliarity: 0.4,
      updatedAfter: 4000,
      updatedBefore: 8000,
      orderBy: 'interactionCount',
      order: 'desc',
      limit: 2,
    })

    // b4 archived、b5 异 life 排除；interactionCount 降序窗口 [b2(30), b3(20)]
    expect(result.bonds.map((b) => b.id)).toEqual(['b2', 'b3'])
    expect(result.total).toBe(2)
    expect(collection.findCalls[0]).toEqual({
      'bond.lifeId': 'life-A',
      'bond.status': { $in: ['active'] },
      'bond.metrics.familiarity': { $gte: 0.4 },
      'bond.updatedAt': { $gte: 4000, $lte: 8000 },
    })
    expect(collection.findOptions[0]).toEqual({
      sort: { 'bond.interactionCount': -1, 'bond.updatedAt': -1 },
      limit: 2,
    })
  })

  it('tags 大小写不敏感 ALL 语义内存精滤；不下推 tags 键', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1', { tags: ['Friend', 'VIP'] }))
    await repo.save(createBond('b2', 'life-A', 'actor-2', { tags: ['friend'] }))
    await repo.save(createBond('b3', 'life-A', 'actor-3', { tags: ['Friend', 'regular'] }))

    collection.findCalls = []
    const result = await repo.query({ lifeId: 'life-A', tags: ['friend', 'vip'] })
    expect(result.bonds.map((b) => b.id)).toEqual(['b1'])
    expect(collection.findCalls[0]).not.toHaveProperty('bond.tags')
  })

  it('listByLife 走同一下推路径；指标排序取 bond.metrics.* 字段', async () => {
    const collection = new FaithfulMongoCollection<MongoBondDocument>()
    const repo = new MongoBondRepository(collection as never, { collectionName: 'd1_bond' })
    await repo.save(createBond('b1', 'life-A', 'actor-1', { metrics: { familiarity: 0.5, intimacy: 0.9, trust: 0.6, tension: 0.1, dependence: 0.2 } }))
    await repo.save(createBond('b2', 'life-A', 'actor-2', { metrics: { familiarity: 0.5, intimacy: 0.2, trust: 0.6, tension: 0.1, dependence: 0.2 } }))
    await repo.save(createBond('b3', 'life-B', 'actor-3'))

    collection.findCalls = []
    collection.findOptions = []
    const bonds = await repo.listByLife('life-A', { orderBy: 'intimacy', order: 'desc' })
    expect(bonds.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(collection.findCalls[0]).toEqual({
      'bond.lifeId': 'life-A',
      'bond.status': { $ne: 'deleted' },
    })
    expect(collection.findOptions[0]).toEqual({
      sort: { 'bond.metrics.intimacy': -1, 'bond.updatedAt': -1 },
    })
  })
})

