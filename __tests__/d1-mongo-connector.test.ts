/**
 * D1-5 Mongo 连接器测试（裸 driver，URL 连接，可选依赖）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md D1）：
 * 项目不内置 MongoDB，用户自部署，我们只用 URL 去连；`mongodb` 是可选依赖。
 * 本测试用注入的 createMongoClient 验证：
 *   - connectMongo 按 URL connect/close，取集合
 *   - memory/bond 顶层插件配 mongo.uri 即可启用 mongo 仓储（无需注入 repositoryFactory）
 */

import { describe, expect, it, vi } from 'vitest'
import { asCordisContext, type Context } from 'koishi'
import { connectMongo, type MongoClientLike } from '../packages/@elysia-ai/shared/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { createRuntimeStateRepository } from '../packages/elysia-ai-runtime/src/store/runtime-state-repository.js'
import { apply as applyMemory } from '../packages/elysia-ai-memory/src/index.js'
import { apply as applyBond } from '../packages/elysia-ai-bond/src/index.js'

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/** 极简内存 collection，足以支撑连接器测试的 find/updateOne。 */
function makeCollection() {
  const docs = new Map<string, { id: string } & Record<string, unknown>>()
  return {
    docs,
    findOne: async (filter: Record<string, unknown>) => {
      for (const d of docs.values()) {
        if (Object.entries(filter).every(([k, v]) => getPath(d, k) === v)) return d
      }
      return null
    },
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => [...docs.values()].filter((d) => Object.entries(filter).every(([k, v]) => getPath(d, k) === v)),
    }),
    updateOne: async (filter: { id: string }, update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }, _o: { upsert: boolean }) => {
      docs.set(filter.id, { id: filter.id, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) } as never)
    },
    createIndex: async () => 'idx',
  }
}

/** 注入用的假 MongoClient：记录 connect/close 调用次数。 */
function makeFakeClient() {
  const state = { connects: 0, closes: 0 }
  const collections = new Map<string, ReturnType<typeof makeCollection>>()
  const client: MongoClientLike = {
    async connect() { state.connects++ },
    async close() { state.closes++ },
    db() {
      return {
        collection(name: string) {
          if (!collections.has(name)) collections.set(name, makeCollection())
          return collections.get(name) as never
        },
      }
    },
  }
  return { client, state, collections }
}

describe('D1-5 connectMongo（URL 连接）', () => {
  it('按 URL connect 并取集合，close 释放', async () => {
    const { client, state } = makeFakeClient()
    const conn = await connectMongo(
      { uri: 'mongodb://localhost:27017', database: 'test_db' },
      { createMongoClient: () => client },
    )
    expect(state.connects).toBe(1)
    const col = conn.collection('c1')
    await col.updateOne({ id: 'x' }, { $set: { v: 1 }, $setOnInsert: { id: 'x' } }, { upsert: true })
    expect(await col.findOne({ id: 'x' })).toMatchObject({ id: 'x', v: 1 })
    await conn.close()
    expect(state.closes).toBe(1)
  })

  it('空 uri 抛错', async () => {
    await expect(connectMongo({ uri: '' })).rejects.toThrow(/uri/)
  })
})


function createPluginContext() {
  const ctx: Record<string, unknown> = {
    logger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    command: () => ({ action: () => {} }),
    on: () => () => {},
  }
  return asCordisContext(ctx) as unknown as Context & Record<string, unknown>
}

describe('D1-5 memory/bond 经 elysia.persistence 启用 mongo（无需注入 factory）', () => {
  // 架构演进：memory/bond 插件不再各自解析 repository.mongo.uri 配置，
  // 而是由 runtime 插件统一建 mongo 连接并注册 elysia.persistence 服务，
  // 消费方从 persistence.getCollection() 取句柄建 Mongo 仓储（无需注入 repositoryFactory）；
  // 服务未注册或句柄为空时回退内存仓储。缺 uri 的 fail-fast 语义移至 runtime 层配置。

  function installMongoPersistence(ctx: Context & Record<string, unknown>) {
    ;(ctx as Record<string, unknown>)['elysia.persistence'] = {
      mode: 'mongo',
      getCollection: () => makeCollection(),
    }
  }

  it('persistence 提供 mongo collection 时 memory 仓储为 Mongo 实现', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    installMongoPersistence(ctx)
    applyMemory(ctx, { enabled: true, contextLimit: 5 } as never)
    const repo = (ctx as Record<string, any>)['elysia.memory']?.repository
    expect(repo?.constructor?.name).toBe('MongoMemoryRepository')
  })

  it('persistence 提供 mongo collection 时 bond 仓储为 Mongo 实现', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    installMongoPersistence(ctx)
    applyBond(ctx, { enabled: true, contextLimit: 5 } as never)
    const repo = (ctx as Record<string, any>)['elysia.bond']?.repository
    expect(repo?.constructor?.name).toBe('MongoBondRepository')
  })

  it('无 persistence 服务时回退内存仓储', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    applyMemory(ctx, { enabled: true, contextLimit: 5 } as never)
    const repo = (ctx as Record<string, any>)['elysia.memory']?.repository
    expect(repo?.constructor?.name).toBe('MemoryMemoryRepository')
  })

  it('runtime 层 mongo 配置缺 uri 且 failFast=true 时 fail fast', async () => {
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() }
    await expect(
      createRuntimeStateRepository({ stateRepository: 'mongo', failFast: true }, logger),
    ).rejects.toThrow(/uri/)
  })
})
