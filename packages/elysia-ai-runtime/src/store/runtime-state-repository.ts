import type { HomeostasisState, LifeStateRepository } from '@elysia-ai/core'
import type { RuntimeLogger } from '../context/index.js'
import { MemoryStateRepository } from './memory-state-repository.js'
import { MongoStateRepository, type MongoStateCollection } from './mongo-state-repository.js'

export type RuntimeStateRepositoryType = 'memory' | 'mongo'

export interface RuntimeMongoStateRepositoryConfig {
  uri?: string
  database?: string
  collection?: string
  stateType?: string
  failFast?: boolean
}

export interface RuntimeStateRepositoryConfig {
  type?: RuntimeStateRepositoryType
  mongo?: RuntimeMongoStateRepositoryConfig
}

export interface RuntimeStateRepositorySetup {
  repository: LifeStateRepository<HomeostasisState>
  dispose(): Promise<void>
}

export interface MongoClientLike {
  connect(): Promise<unknown>
  close(): Promise<unknown>
  db(name: string): {
    collection(name: string): MongoStateCollection<HomeostasisState>
  }
}

export interface RuntimeStateRepositoryDependencies {
  createMongoClient?(uri: string): MongoClientLike
}

const DEFAULT_MONGO_DATABASE = 'elysia_ai'
const DEFAULT_MONGO_COLLECTION = 'life_states'
const DEFAULT_MONGO_STATE_TYPE = 'homeostasis'

function createMemorySetup(): RuntimeStateRepositorySetup {
  return {
    repository: new MemoryStateRepository<HomeostasisState>(),
    async dispose() {
      // Memory repository has no external resources.
    },
  }
}

async function createDefaultMongoClient(uri: string): Promise<MongoClientLike> {
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ MongoClient: new (uri: string) => MongoClientLike }>

  const mongodb = await importer('mongodb')
  return new mongodb.MongoClient(uri)
}

async function createMongoSetup(
  config: RuntimeMongoStateRepositoryConfig,
  logger: RuntimeLogger,
  dependencies: RuntimeStateRepositoryDependencies,
): Promise<RuntimeStateRepositorySetup> {
  if (!config.uri) {
    throw new Error('Mongo state repository requires mongo.uri')
  }

  const client = dependencies.createMongoClient
    ? dependencies.createMongoClient(config.uri)
    : await createDefaultMongoClient(config.uri)

  await client.connect()

  const database = config.database ?? DEFAULT_MONGO_DATABASE
  const collectionName = config.collection ?? DEFAULT_MONGO_COLLECTION
  const stateType = config.stateType ?? DEFAULT_MONGO_STATE_TYPE
  const collection = client.db(database).collection(collectionName)
  const repository = new MongoStateRepository<HomeostasisState>(collection, {
    stateType,
  })

  await repository.ensureIndexes()

  logger.info('mongo state repository initialized', {
    plugin: 'elysia-ai-runtime',
    phase: 'state-repository',
    database,
    collection: collectionName,
    stateType,
  })

  return {
    repository,
    async dispose() {
      await client.close()
      logger.info('mongo state repository disposed', {
        plugin: 'elysia-ai-runtime',
        phase: 'state-repository',
      })
    },
  }
}

export async function createRuntimeStateRepository(
  config: RuntimeStateRepositoryConfig | undefined,
  logger: RuntimeLogger,
  dependencies: RuntimeStateRepositoryDependencies = {},
): Promise<RuntimeStateRepositorySetup> {
  const type = config?.type ?? 'memory'

  if (type === 'memory') {
    logger.debug('memory state repository selected', {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
    })
    return createMemorySetup()
  }

  if (type !== 'mongo') {
    throw new Error(`Unsupported runtime state repository type: ${String(type)}`)
  }

  const mongoConfig = config?.mongo ?? {}

  try {
    return await createMongoSetup(mongoConfig, logger, dependencies)
  } catch (error) {
    logger.error('failed to initialize mongo state repository', error, {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
      failFast: Boolean(mongoConfig.failFast),
    })

    if (mongoConfig.failFast) {
      throw error
    }

    logger.info('falling back to memory state repository', {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
    })
    return createMemorySetup()
  }
}
