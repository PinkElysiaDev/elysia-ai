/**
 * D1-3 ProjectionRule 的 Mongo 仓储契约测试
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md D1）：
 * 该仓储此前完全无 Mongo 实现。落库后投影规则可持久。
 * 用忠实 Fake（嵌套点路径 filter）验证 CRUD、按维度查询、重启恢复。
 * （MongoScheduledTaskRepository 契约段已随 SchedulerService 退役删除。）
 */

import { describe, expect, it } from 'vitest'
import type { ProjectionRule } from '../packages/@elysia-ai/core/src/index.js'
import {
  MongoProjectionRuleRepository,
  type MongoProjectionRuleDocument,
} from '../packages/elysia-ai-runtime/src/index.js'
import { FaithfulMongoCollection } from './helpers/mongo-fake.js'

function rule(id: string, lifeId: string, enabled?: boolean): ProjectionRule {
  return { id, lifeId, priority: 0, enabled }
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

  it('listEnabled 把 enabled!==false（含 undefined）视为启用（$ne 直接下推）', async () => {
    const collection = new FaithfulMongoCollection<MongoProjectionRuleDocument>()
    const repo = new MongoProjectionRuleRepository(collection)
    await repo.save(rule('r1', 'life-A', true))
    await repo.save(rule('r2', 'life-A', undefined))
    await repo.save(rule('r3', 'life-A', false))

    collection.findCalls = []
    expect((await repo.listEnabled()).map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    // 【D】不再 findMany({}) 全量拉取后内存筛选，而是 $ne: false 服务端过滤
    expect(collection.findCalls).toEqual([{ 'rule.enabled': { $ne: false } }])
    expect((await repo.listAll()).length).toBe(3)
  })

  it('重启（新实例复用同集合）后规则可恢复', async () => {
    const collection = new FaithfulMongoCollection<MongoProjectionRuleDocument>()
    await new MongoProjectionRuleRepository(collection).save(rule('r1', 'life-A'))
    const repo2 = new MongoProjectionRuleRepository(collection)
    expect((await repo2.getById('r1'))?.lifeId).toBe('life-A')
  })
})

// ─────────────────────────────────────────────────
// P0-3：runtime 的 Mongo 仓储接线（createMongoRuntimeRepositories + loadFromRepository）
// ─────────────────────────────────────────────────

import {
  createDefaultRuntime,
  createMongoRuntimeRepositories,
  MONGO_PROJECTION_RULES_COLLECTION,
} from '../packages/elysia-ai-runtime/src/index.js'

describe('P0-3 createMongoRuntimeRepositories 接线', () => {
  it('工厂在指定连接上建立投影规则仓储', async () => {
    const collections: Record<string, FaithfulMongoCollection<{ id: string }>> = {}
    const connection = {
      collection(name: string) {
        return (collections[name] ??= new FaithfulMongoCollection())
      },
    } as never

    const repositories = createMongoRuntimeRepositories(connection)
    await repositories.ensureIndexes()

    expect(Object.keys(collections).sort()).toEqual([
      MONGO_PROJECTION_RULES_COLLECTION,
    ])

    await repositories.projectionRuleRepository.save(rule('r-wired', 'life-A'))
    expect(await repositories.projectionRuleRepository.getById('r-wired')).toBeTruthy()
  })

  it('runtime 使用 Mongo 规则仓储时 loadFromRepository 可恢复路由规则', async () => {
    const collection = new FaithfulMongoCollection<MongoProjectionRuleDocument>()
    await new MongoProjectionRuleRepository(collection).save(rule('r-restore', 'life-restore'))

    const runtime = createDefaultRuntime({
      projectionRuleRepository: new MongoProjectionRuleRepository(collection),
    })
    // load 之前规则只在仓储里，内存 registry 为空（路由不会命中）
    expect(runtime.projectionRegistry.list().map((r) => r.id)).toEqual([])

    await runtime.projectionRuleService.loadFromRepository()

    expect(runtime.projectionRegistry.listEnabled().map((r) => r.id))
      .toEqual(['r-restore'])
  })
})
