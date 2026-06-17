/**
 * Phase 15 Mongo State Repository 集成测试
 *
 * 验证 MongoStateRepository 作为 LifeStateRepository 的 Mongo-compatible 实现：
 * 1. ensureIndexes() 创建 lifeInstanceId + stateType 唯一索引
 * 2. save() 使用 upsert 写入状态
 * 3. getByLifeInstanceId() 能读回状态
 * 4. 不存在的 life 返回 null
 * 5. 多 life 状态互不污染
 * 6. 同一 life 重复 save 会覆盖 state 并保留 createdAt
 */

import { describe, expect, it } from 'vitest'
import type { HomeostasisState } from '../packages/@elysia-ai/core/src/index.js'
import type {
  MongoStateCollection,
  MongoStateDocument,
} from '../packages/elysia-ai-runtime/src/store/mongo-state-repository.js'
import { MongoStateRepository } from '../packages/elysia-ai-runtime/src/store/mongo-state-repository.js'

class FakeMongoStateCollection<TState> implements MongoStateCollection<TState> {
  readonly documents = new Map<string, MongoStateDocument<TState>>()
  readonly indexes: Array<{
    keys: { lifeInstanceId: 1; stateType: 1 }
    options: { unique: true; name: string }
  }> = []

  async findOne(filter: { lifeInstanceId: string; stateType: string }): Promise<MongoStateDocument<TState> | null> {
    return this.documents.get(this.resolveKey(filter.lifeInstanceId, filter.stateType)) ?? null
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

    const key = this.resolveKey(filter.lifeInstanceId, filter.stateType)
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

  private resolveKey(lifeInstanceId: string, stateType: string): string {
    return `${stateType}:${lifeInstanceId}`
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

describe('Phase 15 Mongo State Repository 集成测试', () => {
  it('ensureIndexes() 创建 lifeInstanceId + stateType 唯一索引', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const repository = new MongoStateRepository<HomeostasisState>(collection)

    await repository.ensureIndexes()

    expect(collection.indexes).toEqual([
      {
        keys: { lifeInstanceId: 1, stateType: 1 },
        options: {
          unique: true,
          name: 'life_state_identity_unique',
        },
      },
    ])
  })

  it('save() 使用 upsert 写入状态并可读回', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const repository = new MongoStateRepository<HomeostasisState>(collection)
    const state = createState('life-phase15-save', 0.8)

    await repository.save('life-phase15-save', state)

    const restored = await repository.getByLifeInstanceId('life-phase15-save')
    expect(restored).toEqual(state)
  })

  it('不存在的 life 返回 null', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const repository = new MongoStateRepository<HomeostasisState>(collection)

    await expect(repository.getByLifeInstanceId('life-phase15-missing')).resolves.toBeNull()
  })

  it('多 life 状态互不污染', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const repository = new MongoStateRepository<HomeostasisState>(collection)

    const stateA = createState('life-phase15-a', 0.8)
    const stateB = createState('life-phase15-b', 0.3)

    await repository.save('life-phase15-a', stateA)
    await repository.save('life-phase15-b', stateB)

    await expect(repository.getByLifeInstanceId('life-phase15-a')).resolves.toEqual(stateA)
    await expect(repository.getByLifeInstanceId('life-phase15-b')).resolves.toEqual(stateB)
  })

  it('同一 life 重复 save 会覆盖 state 并保留 createdAt', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const repository = new MongoStateRepository<HomeostasisState>(collection)

    const first = createState('life-phase15-upsert', 0.8)
    const second = createState('life-phase15-upsert', 0.2)

    await repository.save('life-phase15-upsert', first)
    const firstDocument = await collection.findOne({
      lifeInstanceId: 'life-phase15-upsert',
      stateType: 'homeostasis',
    })

    await repository.save('life-phase15-upsert', second)
    const secondDocument = await collection.findOne({
      lifeInstanceId: 'life-phase15-upsert',
      stateType: 'homeostasis',
    })

    expect(secondDocument?.state).toEqual(second)
    expect(secondDocument?.createdAt).toBe(firstDocument?.createdAt)
    expect(secondDocument?.updatedAt).toBeGreaterThanOrEqual(firstDocument?.updatedAt ?? 0)
  })

  it('支持通过 stateType 隔离不同状态类型', async () => {
    const collection = new FakeMongoStateCollection<HomeostasisState>()
    const homeostasisRepository = new MongoStateRepository<HomeostasisState>(collection, {
      stateType: 'homeostasis',
    })
    const memoryRepository = new MongoStateRepository<HomeostasisState>(collection, {
      stateType: 'memory',
    })

    const homeostasisState = createState('life-phase15-state-type', 0.8)
    const memoryState = createState('life-phase15-state-type', 0.1)

    await homeostasisRepository.save('life-phase15-state-type', homeostasisState)
    await memoryRepository.save('life-phase15-state-type', memoryState)

    await expect(homeostasisRepository.getByLifeInstanceId('life-phase15-state-type')).resolves.toEqual(homeostasisState)
    await expect(memoryRepository.getByLifeInstanceId('life-phase15-state-type')).resolves.toEqual(memoryState)
  })
})
