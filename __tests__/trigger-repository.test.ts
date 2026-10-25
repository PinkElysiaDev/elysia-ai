import { describe, expect, it, vi } from 'vitest'
import type { PersistenceService, TriggerTask } from '@elysia-ai/core'
import {
  MONGO_TRIGGER_TASKS_COLLECTION,
  MongoTriggerTaskRepository,
  resolveTriggerTaskRepository,
} from '../packages/@elysia-ai/behavior/src/mongo-trigger-task-repository.js'
import type { MongoTriggerTaskDocument } from '../packages/@elysia-ai/behavior/src/mongo-trigger-task-repository.js'
import { applyFindOptions, getPath, matchesFilter, setPath, type MongoFakeFindOptions } from './helpers/mongo-fake.js'

const BASE = 1_700_000_000_000

function sampleTask(overrides: Partial<TriggerTask> = {}): TriggerTask {
  return {
    id: 't-1',
    name: '测试任务',
    enabled: true,
    habitatId: 'g1',
    condition: { type: 'interval', everyMinutes: 10, misfire: 'skip' },
    prompt: 'p',
    ownerKey: 'onebot:bot1:admin',
    createdAt: BASE,
    updatedAt: BASE,
    state: {
      status: 'waiting', nextRunAt: BASE + 600_000, occurrenceKey: 'k',
      lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null,
    },
    ...overrides,
  }
}

/** 内存 fake collection：实现 MongoDocLikeCollection 最小契约（matchesFilter 走共享求值器，find 支持 options，
 * 文档形态 { task } 无外层骨架，updateOne/deleteOne 按完整 filter 定位、$set/$inc 走点路径）。 */
function fakeCollection() {
  const docs = new Map<string, MongoTriggerTaskDocument>()
  let nextKey = 0
  const createdIndexes: Array<{ keys: Record<string, unknown>, options?: Record<string, unknown> }> = []
  const findCalls: Array<{ filter: Record<string, unknown>, options?: MongoFakeFindOptions }> = []

  function findKey(filter: Record<string, unknown>): string | undefined {
    for (const [key, doc] of docs) {
      if (matchesFilter(doc, filter)) return key
    }
    return undefined
  }

  function applyUpdate(target: Record<string, unknown>, update: { $set?: Record<string, unknown>, $inc?: Record<string, number> }): void {
    for (const [path, value] of Object.entries(update.$set ?? {})) setPath(target, path, value)
    for (const [path, by] of Object.entries(update.$inc ?? {})) {
      const current = getPath(target, path)
      setPath(target, path, (typeof current === 'number' ? current : 0) + by)
    }
  }

  const collection = {
    async findOne(filter: Record<string, unknown>) {
      for (const doc of docs.values()) {
        if (matchesFilter(doc, filter)) return doc
      }
      return null
    },
    async find(filter: Record<string, unknown>, options?: MongoFakeFindOptions) {
      findCalls.push({ filter, options })
      return applyFindOptions([...docs.values()].filter((doc) => matchesFilter(doc, filter)), options)
    },
    async countDocuments(filter: Record<string, unknown>) {
      return [...docs.values()].filter((doc) => matchesFilter(doc, filter)).length
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>, $setOnInsert?: Record<string, unknown>, $inc?: Record<string, number> },
      options: { upsert: boolean },
    ) {
      const key = findKey(filter)
      if (key === undefined) {
        if (!options.upsert) return { matchedCount: 0 }
        const base: Record<string, unknown> = { ...(update.$setOnInsert ?? {}) }
        applyUpdate(base, update)
        docs.set(`doc-${nextKey++}`, base as MongoTriggerTaskDocument)
        return { matchedCount: 0, upsertedCount: 1 }
      }
      applyUpdate(docs.get(key) as unknown as Record<string, unknown>, update)
      return { matchedCount: 1 }
    },
    async deleteOne(filter: Record<string, unknown>) {
      const key = findKey(filter)
      const had = key !== undefined ? docs.delete(key) : false
      return { deletedCount: had ? 1 : 0 }
    },
    async createIndex(keys: Record<string, unknown>, options?: Record<string, unknown>) {
      createdIndexes.push({ keys, options })
    },
  }
  return { collection, docs, createdIndexes, findCalls }
}

describe('MongoTriggerTaskRepository（fake collection 往返）', () => {
  it('save/upsert → get 克隆往返；query 服务端 filter 映射；remove 归一 boolean；countByOwner', async () => {
    const { collection, createdIndexes } = fakeCollection()
    const repo = new MongoTriggerTaskRepository(collection)

    const task = sampleTask()
    await repo.save(task)
    await repo.save({ ...task, name: '改名' })  // upsert 幂等

    const loaded = await repo.get('t-1')
    expect(loaded?.name).toBe('改名')
    expect(loaded?.condition).toEqual(task.condition)
    // 克隆语义：改返回值不影响存储
    loaded!.state.runCount = 99
    expect((await repo.get('t-1'))!.state.runCount).toBe(0)

    await repo.save(sampleTask({ id: 't-2', habitatId: 'g2', enabled: false, ownerKey: 'other' }))
    await repo.save(sampleTask({ id: 't-3', habitatId: 'g1', ownerKey: 'onebot:bot1:admin' }))

    expect((await repo.query()).length).toBe(3)
    expect((await repo.query({ habitatId: 'g1' })).map((item) => item.id).sort()).toEqual(['t-1', 't-3'])
    expect((await repo.query({ enabled: true })).map((item) => item.id).sort()).toEqual(['t-1', 't-3'])
    expect(await repo.countByOwner('onebot:bot1:admin')).toBe(2)

    expect(await repo.remove('t-2')).toBe(true)
    expect(await repo.remove('t-2')).toBe(false)
    expect((await repo.query()).length).toBe(2)

    // 索引：id unique + habitat + owner + 收割复合
    await repo.ensureIndexes()
    const indexNames = createdIndexes.map((spec) => String(spec.options?.['name'] ?? ''))
    expect(indexNames).toContain(`${MONGO_TRIGGER_TASKS_COLLECTION}_id_unique`)
    expect(indexNames).toContain(`${MONGO_TRIGGER_TASKS_COLLECTION}_harvest`)
  })
})

describe('D 收割直查（listDue $or 下推 + countByOwner 计数化）', () => {
  const NOW = BASE + 1_000_000

  function state(overrides: Partial<TriggerTask['state']>): TriggerTask['state'] {
    return {
      status: 'waiting', nextRunAt: BASE + 600_000, occurrenceKey: 'k',
      lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null,
      ...overrides,
    }
  }

  it('Mongo listDue：$or（waiting 到期 / paused 恢复点到期）单次服务端查询，nextRunAt 升序', async () => {
    const { collection, findCalls } = fakeCollection()
    const repo = new MongoTriggerTaskRepository(collection as never)
    await repo.save(sampleTask({ id: 'due-waiting', state: state({ status: 'waiting', nextRunAt: NOW - 1000 }) }))
    await repo.save(sampleTask({ id: 'future-waiting', state: state({ status: 'waiting', nextRunAt: NOW + 600_000 }) }))
    await repo.save(sampleTask({ id: 'null-next', state: state({ status: 'waiting', nextRunAt: null }) }))
    await repo.save(sampleTask({ id: 'due-paused', state: state({ status: 'paused', nextRunAt: NOW - 1, pausedUntil: NOW - 1 }) }))
    await repo.save(sampleTask({ id: 'future-paused', state: state({ status: 'paused', nextRunAt: NOW + 600_000, pausedUntil: NOW + 600_000 }) }))
    await repo.save(sampleTask({ id: 'disabled-due', enabled: false, state: state({ status: 'waiting', nextRunAt: NOW - 1 }) }))
    await repo.save(sampleTask({ id: 'running', state: state({ status: 'running', nextRunAt: NOW - 1 }) }))

    const findsBefore = findCalls.length
    const due = await repo.listDue(NOW)
    expect(due.map((task) => task.id)).toEqual(['due-waiting', 'due-paused'])
    expect(findCalls.length).toBe(findsBefore + 1)  // 单次 find，无全量 query()
    expect(findCalls.at(-1)?.filter).toEqual({
      'task.enabled': true,
      $or: [
        { 'task.state.status': 'waiting', 'task.state.nextRunAt': { $ne: null, $lte: NOW } },
        { 'task.state.status': 'paused', 'task.state.pausedUntil': { $ne: null, $lte: NOW } },
      ],
    })
    expect(findCalls.at(-1)?.options).toEqual({ sort: { 'task.state.nextRunAt': 1 } })
  })

  it('Mongo countByOwner：走 countDocuments（不再 findMany 全拉）', async () => {
    const { collection, findCalls } = fakeCollection()
    const repo = new MongoTriggerTaskRepository(collection as never)
    await repo.save(sampleTask({ id: 't-1', ownerKey: 'owner-a' }))
    await repo.save(sampleTask({ id: 't-2', ownerKey: 'owner-a' }))
    await repo.save(sampleTask({ id: 't-3', ownerKey: 'owner-b' }))

    const findsBefore = findCalls.length
    expect(await repo.countByOwner('owner-a')).toBe(2)
    expect(await repo.countByOwner('owner-b')).toBe(1)
    expect(await repo.countByOwner('owner-c')).toBe(0)
    expect(findCalls.length).toBe(findsBefore)  // 零 find 调用
    expect(collection.countDocuments).toBeTypeOf('function')
  })

  it('内存仓储 listDue：与原 harvest 过滤一致（waiting 到期 / paused 恢复点 / enabled 闸门）', async () => {
    const { MemoryTriggerTaskRepository } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const store = new MemoryTriggerTaskRepository()
    await store.save(sampleTask({ id: 'due-waiting', state: state({ status: 'waiting', nextRunAt: NOW - 1 }) }))
    await store.save(sampleTask({ id: 'future-waiting', state: state({ status: 'waiting', nextRunAt: NOW + 600_000 }) }))
    await store.save(sampleTask({ id: 'due-paused', state: state({ status: 'paused', pausedUntil: NOW - 1, nextRunAt: null }) }))
    await store.save(sampleTask({ id: 'disabled-due', enabled: false, state: state({ status: 'waiting', nextRunAt: NOW - 1 }) }))

    expect((await store.listDue(NOW)).map((task) => task.id).sort()).toEqual(['due-paused', 'due-waiting'])
  })
})

describe('P3a 触发器防重（CAS 认领）', () => {
  const BASE = 1_700_000_000_000

  function waitingTask(occurrenceKey: string): TriggerTask {
    return {
      id: 't-cas', name: 'x', enabled: true, habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o',
      createdAt: BASE, updatedAt: BASE,
      state: { status: 'waiting', nextRunAt: BASE + 600_000, occurrenceKey, lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null },
    }
  }

  it('内存仓储：waiting + 轮次匹配才抢到；二次认领同轮必败', async () => {
    const { MemoryTriggerTaskRepository } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const store = new MemoryTriggerTaskRepository()
    await store.save(waitingTask('round-1'))

    expect(await store.claim('t-cas', 'round-1', BASE)).toBe(true)
    // 抢到后状态已是 running：同轮二次认领失败（另一进程/竞态路径）
    expect(await store.claim('t-cas', 'round-1', BASE)).toBe(false)
    // 错误轮次也失败
    expect(await store.claim('t-cas', 'round-2', BASE)).toBe(false)
    const after = await store.get('t-cas')
    expect(after?.state.status).toBe('running')
    expect(after?.state.lastRunAt).toBe(BASE)
  })

  it('Mongo 仓储：CAS filter 映射正确（id+waiting+occurrenceKey 三条件）', async () => {
    const { collection } = fakeCollection()
    const updateCalls: Array<{ filter: Record<string, unknown>, update: Record<string, unknown> }> = []
    collection.updateOne = async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updateCalls.push({ filter, update })
      return { matchedCount: 1 }
    }
    const repo = new MongoTriggerTaskRepository(collection as never)
    expect(await repo.claim('t-1', 'round-9', BASE)).toBe(true)
    expect(updateCalls[0].filter).toEqual({
      'task.id': 't-1',
      'task.state.status': 'waiting',
      'task.state.occurrenceKey': 'round-9',
    })
    expect(updateCalls[0].update.$set).toMatchObject({
      'task.state.status': 'running',
      'task.state.lastRunAt': BASE,
    })
    // matchedCount 0 → 抢不到
    collection.updateOne = async () => ({ matchedCount: 0 })
    expect(await repo.claim('t-1', 'round-9', BASE)).toBe(false)
  })

  it('runTask：认领失败不点火（双进程场景的进程内模拟）', async () => {
    const { MemoryTriggerTaskRepository, TriggerManager } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const fires: unknown[] = []
    let now = BASE
    const store = new MemoryTriggerTaskRepository()
    // 预置已被"另一进程"认领（running）的任务，但收割快照是 waiting 旧态：
    // 直接构造 harvest 拿到 waiting 快照、store 内已 running 的竞态
    const snapshot = waitingTask('round-1')
    await store.save({ ...snapshot, state: { ...snapshot.state, status: 'running' } })
    const manager = new TriggerManager({
      store,
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: () => { fires.push(1) },
      checkAdmin: async () => true,
      now: () => now,
    })
    // 直接调 runTask（绕过 harvest 的 waiting 过滤，模拟竞态窗口）
    await manager['runTask'](snapshot, now)
    expect(fires).toHaveLength(0) // 认领失败 → 不点火
    void now
  })
})

describe('resolveTriggerTaskRepository（双模式选择链）', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() }

  function mongoPersistence(hasCollection = true): PersistenceService {
    return {
      mode: 'mongo',
      getCollection: () => (hasCollection ? (fakeCollection().collection as never) : undefined),
    }
  }

  it('auto + mongo persistence → Mongo 仓储（索引 fire-and-forget）', async () => {
    const result = resolveTriggerTaskRepository({
      repository: 'auto',
      getPersistence: () => mongoPersistence(),
      logger,
    })
    expect(result.mode).toBe('mongo')
    expect(result.repository).toBeInstanceOf(MongoTriggerTaskRepository)
  })

  it('auto + memory persistence / 无服务 / getCollection 空 / 强制 memory → 内存回退', () => {
    const memoryPersistence: PersistenceService = { mode: 'memory', getCollection: () => undefined }
    expect(resolveTriggerTaskRepository({ repository: 'auto', getPersistence: () => memoryPersistence, logger }).mode).toBe('memory')
    expect(resolveTriggerTaskRepository({ repository: 'auto', getPersistence: () => undefined, logger }).mode).toBe('memory')
    expect(resolveTriggerTaskRepository({ repository: 'auto', getPersistence: () => mongoPersistence(false), logger }).mode).toBe('memory')
    expect(resolveTriggerTaskRepository({ repository: 'memory', getPersistence: () => mongoPersistence(), logger }).mode).toBe('memory')
  })

  it('getPersistence 抛异常 → 内存回退（不中断）', () => {
    const result = resolveTriggerTaskRepository({
      repository: 'auto',
      getPersistence: () => { throw new Error('service boom') },
      logger,
    })
    expect(result.mode).toBe('memory')
    expect(logger.error).toHaveBeenCalled()
  })
})
