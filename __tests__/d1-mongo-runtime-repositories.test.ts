/**
 * D1-3 ProjectionRule / ScheduledTask 的 Mongo 仓储契约测试
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md D1）：
 * 这两个仓储此前完全无 Mongo 实现。落库后投影规则可持久、调度器可跨重启续跑。
 * 用忠实 Fake（嵌套点路径 filter）验证 CRUD、按维度查询、状态迁移、重启恢复。
 */

import { describe, expect, it } from 'vitest'
import type { ProjectionRule, ScheduledTask } from '../packages/@elysia-ai/core/src/index.js'
import {
  MongoProjectionRuleRepository,
  type MongoProjectionRuleDocument,
  MongoScheduledTaskRepository,
  type MongoScheduledTaskDocument,
} from '../packages/elysia-ai-runtime/src/index.js'

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

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

class FaithfulMongoCollection<TDoc extends { id: string }> {
  readonly documents = new Map<string, TDoc>()
  readonly indexes: Array<{ keys: Record<string, 1 | -1>; options?: Record<string, unknown> }> = []

  private matches(doc: TDoc, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => getPath(doc, key) === value)
  }

  async findOne(filter: Record<string, unknown>): Promise<TDoc | null> {
    for (const doc of this.documents.values()) if (this.matches(doc, filter)) return doc
    return null
  }

  find(filter: Record<string, unknown>): { toArray(): Promise<TDoc[]> } {
    const matched = [...this.documents.values()].filter((doc) => this.matches(doc, filter))
    return { toArray: async () => matched }
  }

  async updateOne(
    filter: { id: string },
    update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown>; $inc?: Record<string, number> },
    options: { upsert: boolean },
  ): Promise<unknown> {
    const id = String(filter.id)
    const existing = this.documents.get(id)
    if (!existing && !options.upsert) return { matchedCount: 0 }
    const base: Record<string, unknown> = existing ? structuredClone(existing) : { ...(update.$setOnInsert ?? {}) }
    for (const [k, v] of Object.entries(update.$set ?? {})) setPath(base, k, v)
    for (const [k, by] of Object.entries(update.$inc ?? {})) {
      const cur = getPath(base, k)
      setPath(base, k, (typeof cur === 'number' ? cur : 0) + by)
    }
    this.documents.set(id, base as TDoc)
    return { matchedCount: existing ? 1 : 0 }
  }

  async deleteOne(filter: { id: string }): Promise<unknown> {
    return { deletedCount: this.documents.delete(String(filter.id)) ? 1 : 0 }
  }

  async createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown> {
    this.indexes.push({ keys, options })
    return 'idx'
  }
}

function rule(id: string, lifeId: string, enabled?: boolean): ProjectionRule {
  return { id, lifeId, priority: 0, enabled }
}

function task(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    type: 'followup',
    status: 'pending',
    target: {},
    runAt: 1000,
    createdAt: 1000,
    updatedAt: 1000,
    priority: 0,
    payload: {},
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  }
}

describe('D1-3 MongoProjectionRuleRepository', () => {
  it('save / getById / listByLifeId / remove', async () => {
    const repo = new MongoProjectionRuleRepository(new FaithfulMongoCollection<MongoProjectionRuleDocument>())
    await repo.save(rule('r1', 'life-A'))
    await repo.save(rule('r2', 'life-B'))

    expect((await repo.getById('r1'))?.lifeId).toBe('life-A')
    expect((await repo.listByLifeId('life-A')).map((r) => r.id)).toEqual(['r1'])

    await repo.remove('r1')
    expect(await repo.getById('r1')).toBeNull()
  })

  it('listEnabled 把 enabled!==false（含 undefined）视为启用', async () => {
    const repo = new MongoProjectionRuleRepository(new FaithfulMongoCollection<MongoProjectionRuleDocument>())
    await repo.save(rule('r1', 'life-A', true))
    await repo.save(rule('r2', 'life-A', undefined))
    await repo.save(rule('r3', 'life-A', false))

    expect((await repo.listEnabled()).map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect((await repo.listAll()).length).toBe(3)
  })

  it('重启（新实例复用同集合）后规则可恢复', async () => {
    const collection = new FaithfulMongoCollection<MongoProjectionRuleDocument>()
    await new MongoProjectionRuleRepository(collection).save(rule('r1', 'life-A'))
    const repo2 = new MongoProjectionRuleRepository(collection)
    expect((await repo2.getById('r1'))?.lifeId).toBe('life-A')
  })
})

describe('D1-3 MongoScheduledTaskRepository', () => {
  it('save / getById / listByLifeId / remove', async () => {
    const repo = new MongoScheduledTaskRepository(new FaithfulMongoCollection<MongoScheduledTaskDocument>())
    await repo.save(task('t1', { target: { lifeId: 'life-A' } }))
    await repo.save(task('t2', { target: { lifeId: 'life-B' } }))

    expect((await repo.getById('t1'))?.id).toBe('t1')
    expect((await repo.listByLifeId('life-A')).map((t) => t.id)).toEqual(['t1'])

    await repo.remove('t1')
    expect(await repo.getById('t1')).toBeNull()
  })

  it('listDue 只取 pending 且 runAt<=now，按 priority desc + runAt asc 排序', async () => {
    const repo = new MongoScheduledTaskRepository(new FaithfulMongoCollection<MongoScheduledTaskDocument>())
    await repo.save(task('low', { runAt: 500, priority: 1 }))
    await repo.save(task('high', { runAt: 800, priority: 5 }))
    await repo.save(task('future', { runAt: 9999, priority: 9 }))
    await repo.save(task('done', { runAt: 100, priority: 9, status: 'completed' }))

    const due = await repo.listDue(1000)
    expect(due.map((t) => t.id)).toEqual(['high', 'low'])
  })

  it('complete / cancel 迁移状态', async () => {
    const repo = new MongoScheduledTaskRepository(new FaithfulMongoCollection<MongoScheduledTaskDocument>())
    await repo.save(task('t1'))
    await repo.complete('t1')
    expect((await repo.getById('t1'))?.status).toBe('completed')

    await repo.save(task('t2'))
    await repo.cancel('t2', 'no longer needed')
    const cancelled = await repo.getById('t2')
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.metadata?.cancelReason).toBe('no longer needed')
  })

  it('fail 在未达上限且给定 nextRunAt 时重排为 pending，否则置 failed', async () => {
    const repo = new MongoScheduledTaskRepository(new FaithfulMongoCollection<MongoScheduledTaskDocument>())
    await repo.save(task('retry', { attempts: 0, maxAttempts: 3 }))
    await repo.fail('retry', 'boom', 5000)
    const retried = await repo.getById('retry')
    expect(retried?.status).toBe('pending')
    expect(retried?.attempts).toBe(1)
    expect(retried?.runAt).toBe(5000)
    expect(retried?.lastError).toBe('boom')

    await repo.save(task('dead', { attempts: 2, maxAttempts: 3 }))
    await repo.fail('dead', 'final')
    expect((await repo.getById('dead'))?.status).toBe('failed')
  })

  it('重启（新实例复用同集合）后 pending 任务可被 listDue 续跑', async () => {
    const collection = new FaithfulMongoCollection<MongoScheduledTaskDocument>()
    await new MongoScheduledTaskRepository(collection).save(task('t1', { runAt: 100 }))
    const repo2 = new MongoScheduledTaskRepository(collection)
    expect((await repo2.listDue(1000)).map((t) => t.id)).toEqual(['t1'])
  })
})
