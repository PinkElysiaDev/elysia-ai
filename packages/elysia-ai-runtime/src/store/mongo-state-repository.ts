import type { LifeStateRepository } from '@elysia-ai/core'

// ─────────────────────────────────────────────────
// Mongo-compatible collection contract
// ─────────────────────────────────────────────────

export interface MongoStateDocument<TState = Record<string, unknown>> {
  lifeInstanceId: string
  stateType: string
  state: TState
  createdAt: number
  updatedAt: number
}

export interface MongoStateCollection<TState = Record<string, unknown>> {
  findOne(filter: { lifeInstanceId: string; stateType: string }): Promise<MongoStateDocument<TState> | null>
  updateOne(
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
  ): Promise<unknown>
  createIndex?(
    keys: { lifeInstanceId: 1; stateType: 1 },
    options: { unique: true; name: string },
  ): Promise<unknown>
}

export interface MongoStateRepositoryOptions {
  stateType?: string
}

// ─────────────────────────────────────────────────
// Mongo State Repository
// ─────────────────────────────────────────────────

export class MongoStateRepository<TState = Record<string, unknown>> implements LifeStateRepository<TState> {
  private readonly stateType: string

  constructor(
    private readonly collection: MongoStateCollection<TState>,
    options: MongoStateRepositoryOptions = {},
  ) {
    this.stateType = options.stateType ?? 'homeostasis'
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex?.(
      { lifeInstanceId: 1, stateType: 1 },
      {
        unique: true,
        name: 'life_state_identity_unique',
      },
    )
  }

  async getByLifeInstanceId(lifeInstanceId: string): Promise<TState | null> {
    const document = await this.collection.findOne({
      lifeInstanceId,
      stateType: this.stateType,
    })

    return document?.state ?? null
  }

  async save(lifeInstanceId: string, state: TState): Promise<void> {
    const now = Date.now()

    await this.collection.updateOne(
      {
        lifeInstanceId,
        stateType: this.stateType,
      },
      {
        $set: {
          state,
          updatedAt: now,
        },
        $setOnInsert: {
          lifeInstanceId,
          stateType: this.stateType,
          createdAt: now,
        },
      },
      {
        upsert: true,
      },
    )
  }
}
