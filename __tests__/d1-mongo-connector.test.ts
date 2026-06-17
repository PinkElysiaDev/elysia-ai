/**
 * D1-5 Mongo 连接器测试（裸 driver，URL 连接，可选依赖）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md D1）：
 * 项目不内置 MongoDB，用户自部署，我们只用 URL 去连；`mongodb` 是可选依赖。
 * 本测试用注入的 createMongoClient 验证：
 *   - connectMongo 按 URL connect/close，取集合
 *   - lazyMongoCollection 首次读写才连库（同步可得句柄），连接只建一次，close 释放
 *   - memory/bond 顶层插件配 mongo.uri 即可启用 mongo 仓储（无需注入 repositoryFactory）
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'koishi'
import { connectMongo, lazyMongoCollection, type MongoClientLike } from '../packages/@elysia-ai/shared/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
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

describe('D1-5 lazyMongoCollection（惰性连接）', () => {
  it('未访问时不连库；首次读写才 connect，且只连一次', async () => {
    const { client, state } = makeFakeClient()
    const lazy = lazyMongoCollection(
      { uri: 'mongodb://localhost:27017' },
      'lazy_c',
      { createMongoClient: () => client },
    )
    expect(state.connects).toBe(0)

    await lazy.collection.updateOne({ id: 'a' }, { $set: { n: 1 }, $setOnInsert: { id: 'a' } }, { upsert: true })
    await lazy.collection.findOne({ id: 'a' })
    await lazy.collection.find({}).toArray()
    expect(state.connects).toBe(1)

    await lazy.close()
    expect(state.closes).toBe(1)
  })

  it('从未访问则 close 为 no-op', async () => {
    const { client, state } = makeFakeClient()
    const lazy = lazyMongoCollection({ uri: 'mongodb://x' }, 'c', { createMongoClient: () => client })
    await lazy.close()
    expect(state.connects).toBe(0)
    expect(state.closes).toBe(0)
  })
})

function createPluginContext() {
  const ctx: Record<string, unknown> = {
    logger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    command: () => ({ action: () => {} }),
    on: () => () => {},
  }
  return ctx as unknown as Context & Record<string, unknown>
}

describe('D1-5 memory/bond 配 mongo.uri 即启用（无需注入 factory）', () => {
  it('memory 配 uri 后 repository 为 Mongo 实现', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    applyMemory(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo', mongo: { uri: 'mongodb://localhost:27017', collectionName: 'm' } },
    } as never)
    const repo = (ctx as Record<string, any>)['elysia.memory']?.repository
    expect(repo?.constructor?.name).toBe('MongoMemoryRepository')
  })

  it('bond 配 uri 后 repository 为 Mongo 实现', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    applyBond(ctx, {
      enabled: true,
      contextLimit: 5,
      repository: { type: 'mongo', mongo: { uri: 'mongodb://localhost:27017', collectionName: 'b' } },
    } as never)
    const repo = (ctx as Record<string, any>)['elysia.bond']?.repository
    expect(repo?.constructor?.name).toBe('MongoBondRepository')
  })

  it('mongo 类型但既无 uri 也无 factory 时 fail fast', () => {
    const ctx = createPluginContext()
    ;(ctx as Record<string, unknown>)['elysia.runtime'] = createDefaultRuntime()
    expect(() => applyMemory(ctx, { enabled: true, contextLimit: 5, repository: { type: 'mongo' } } as never)).toThrow(/uri|repositoryFactory/)
  })
})
