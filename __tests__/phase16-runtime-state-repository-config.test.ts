/**
 * Phase 16 Runtime State Repository Config 集成测试
 *
 * 验证 runtime 插件层生命状态仓储配置与 Mongo 生命周期：
 * 1. 默认配置使用 memory repository
 * 2. 显式 memory 配置使用 memory repository
 * 3. Mongo 配置成功时连接 client、创建 collection、初始化索引并可读写
 * 4. Mongo 初始化失败且 failFast=false 时 fallback 到 memory
 * 5. Mongo 初始化失败且 failFast=true 时抛出错误
 * 6. dispose 会关闭 Mongo client
 */

import { describe, expect, it, vi } from 'vitest'
import type { HomeostasisState } from '../packages/@elysia-ai/core/src/index.js'
import { MemoryStateRepository } from '../packages/elysia-ai-runtime/src/store/memory-state-repository.js'
import type {
  MongoClientLike,
} from '../packages/elysia-ai-runtime/src/store/runtime-state-repository.js'
import {
  createRuntimeStateRepository,
} from '../packages/elysia-ai-runtime/src/store/runtime-state-repository.js'
import type {
  MongoStateCollection,
  MongoStateDocument,
} from '../packages/elysia-ai-runtime/src/store/mongo-state-repository.js'

class FakeMongoStateCollection<TState> implements MongoStateCollection<TState> {
  readonly documents = new Map<string, MongoStateDocument<TState>>()
  readonly indexes: Array<{
    keys: { lifeInstanceId: 1; stateType: 1 }
    options: { unique: true; name: string }
  }> = []

  async findOne(filter: { lifeInstanceId: string; stateType: string }): Promise<MongoStateDocument<TState> | null> {
    return this.documents.get(`${filter.stateType}:${filter.lifeInstanceId}`) ?? null
  }

  async updateOne(
    filter: { lifeInstanceId: string; stateType: string },
    update: {
      $set: {
        state: TState
        updatedAt: number
      }
      $setOnInsert: {
        lifeInstanceId: string
        stateType: string
        createdAt: number
      }
    },
    options: { upsert: true },
  ): Promise<unknown> {
    if (!options.upsert) throw new Error('FakeMongoStateCollection only supports upsert updates')

    const key = `${filter.stateType}:${filter.lifeInstanceId}`
    const existing = this.documents.get(key)

    this.documents.set(key, {
      lifeInstanceId: update.$setOnInsert.lifeInstanceId,
      stateType: update.$setOnInsert.stateType,
      createdAt: existing?.createdAt ?? update.$setOnInsert.createdAt,
      updatedAt: update.$set.updatedAt,
      state: update.$set.state,
    })

    return { acknowledged: true }
  }

  async createIndex(
    keys: { lifeInstanceId: 1; stateType: 1 },
    options: { unique: true; name: string },
  ): Promise<unknown> {
    this.indexes.push({ keys, options })
    return options.name
  }
}

class FakeMongoClient implements MongoClientLike {
  readonly connect = vi.fn(async () => undefined)
  readonly close = vi.fn(async () => undefined)
  readonly dbCalls: string[] = []
  readonly collectionCalls: string[] = []

  constructor(readonly collection: FakeMongoStateCollection<HomeostasisState>) {}

  db(name: string) {
    this.dbCalls.push(name)

    return {
      collection: (collectionName: string) => {
        this.collectionCalls.push(collectionName)
        return this.collection
      },
    }
  }
}

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }
}

function createState(lifeInstanceId: string, energy: number): HomeostasisState {
  return {
    lifeInstanceId,
    timestamp: Date.now(),
    energy,
    mood: 0.6,
    sociability: 0.5,
    curiosity: 0.7,
    responseThreshold: 0.4,
  }
}

describe('Phase 16 Runtime State Repository Config 集成测试', () => {
  it('默认配置使用 memory repository', async () => {
    const logger = createLogger()

    const setup = await createRuntimeStateRepository(undefined, logger)

    expect(setup.repository).toBeInstanceOf(MemoryStateRepository)
    await expect(setup.dispose()).resolves.toBeUndefined()
    expect(logger.debug).toHaveBeenCalledWith('memory state repository selected', {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
    })
  })

  it('显式 memory 配置使用 memory repository', async () => {
    const logger = createLogger()

    const setup = await createRuntimeStateRepository({ type: 'memory' }, logger)

    expect(setup.repository).toBeInstanceOf(MemoryStateRepository)
  })

  it('Mongo 配置成功时连接 client、创建 collection、初始化索引并可读写', async () => {
    const logger = createLogger()
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const client = new FakeMongoClient(collection)

    const setup = await createRuntimeStateRepository(
      {
        type: 'mongo',
        mongo: {
          uri: 'mongodb://localhost:27017',
          database: 'phase16_db',
          collection: 'phase16_states',
          stateType: 'homeostasis',
        },
      },
      logger,
      {
        createMongoClient(uri) {
          expect(uri).toBe('mongodb://localhost:27017')
          return client
        },
      },
    )

    const state = createState('life-phase16-mongo', 0.82)
    await setup.repository.save('life-phase16-mongo', state)

    await expect(setup.repository.getByLifeInstanceId('life-phase16-mongo')).resolves.toEqual(state)
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.dbCalls).toEqual(['phase16_db'])
    expect(client.collectionCalls).toEqual(['phase16_states'])
    expect(collection.indexes).toHaveLength(1)
    expect(collection.indexes[0].options.name).toBe('life_state_identity_unique')

    await setup.dispose()
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it('Mongo 初始化失败且 failFast=false 时 fallback 到 memory', async () => {
    const logger = createLogger()

    const setup = await createRuntimeStateRepository(
      {
        type: 'mongo',
        mongo: {
          uri: 'mongodb://localhost:27017',
          failFast: false,
        },
      },
      logger,
      {
        createMongoClient() {
          return {
            async connect() {
              throw new Error('connect failed')
            },
            async close() {},
            db() {
              throw new Error('db should not be called')
            },
          }
        },
      },
    )

    expect(setup.repository).toBeInstanceOf(MemoryStateRepository)
    expect(logger.error).toHaveBeenCalledWith(
      'failed to initialize mongo state repository',
      expect.any(Error),
      {
        plugin: 'elysia-ai-runtime',
        phase: 'state-repository',
        failFast: false,
      },
    )
    expect(logger.info).toHaveBeenCalledWith('falling back to memory state repository', {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
    })
  })

  it('Mongo 初始化失败且 failFast=true 时抛出错误', async () => {
    const logger = createLogger()

    await expect(createRuntimeStateRepository(
      {
        type: 'mongo',
        mongo: {
          uri: 'mongodb://localhost:27017',
          failFast: true,
        },
      },
      logger,
      {
        createMongoClient() {
          return {
            async connect() {
              throw new Error('connect failed')
            },
            async close() {},
            db() {
              throw new Error('db should not be called')
            },
          }
        },
      },
    )).rejects.toThrow('connect failed')
  })

  it('Mongo 缺少 uri 且 failFast=false 时 fallback 到 memory', async () => {
    const logger = createLogger()

    const setup = await createRuntimeStateRepository(
      {
        type: 'mongo',
        mongo: {
          failFast: false,
        },
      },
      logger,
    )

    expect(setup.repository).toBeInstanceOf(MemoryStateRepository)
  })
})
