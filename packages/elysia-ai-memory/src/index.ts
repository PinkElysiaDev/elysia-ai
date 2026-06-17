import { Schema, type Context } from 'koishi'
import { createMemoryPluginRuntime, MongoMemoryRepository } from '@elysia-ai/memory'
import type { Config as MemoryConfig, MemoryRepositoryFactoryOptions, MongoMemoryCollection, MongoMemoryRepositoryOptions } from '@elysia-ai/memory'
import type { CoreEventMap, EventBus, MemoryContextProvider, MemoryRepository, MemoryService } from '@elysia-ai/core'
import {
  createPreflightResult,
  getRequiredElysiaService,
  issue,
  lazyMongoCollection,
  registerElysiaService,
  type LazyMongoCollection,
} from '@elysia-ai/shared'
export * from '@elysia-ai/memory'


type MemoryPluginConfig = MemoryConfig & {
  repositoryFactory?: (options: MemoryRepositoryFactoryOptions) => MemoryRepository
}


export function createMongoMemoryRepositoryFactory(
  collection: MongoMemoryCollection,
  options: MongoMemoryRepositoryOptions = {},
): (factoryOptions: MemoryRepositoryFactoryOptions) => MemoryRepository {
  return () => {
    const repository = new MongoMemoryRepository(collection, options)
    void repository.ensureIndexes()
    return repository
  }
}

// 内建惰性 Mongo 连接的句柄（供 dispose 关闭）。按 apply 调用作用域追踪，不用全局集合。
let activeMongoConnection: LazyMongoCollection<{ id: string }> | undefined

/**
 * 用配置的 mongo.uri 内建一个仓储工厂（惰性连接，首次读写才连库）。
 * 这样宿主只需给 URL，无需自己注入 repositoryFactory。返回 undefined 表示未配 uri。
 * 同时把惰性连接句柄记到 activeMongoConnection，供本次 apply 的 dispose 关闭。
 */
function buildUriRepositoryFactory(
  config: MemoryPluginConfig,
): ((options: MemoryRepositoryFactoryOptions) => MemoryRepository) | undefined {
  const uri = config.repository?.mongo?.uri
  if (!uri) return undefined
  const lazy = lazyMongoCollection<{ id: string }>(
    { uri, database: config.repository?.mongo?.database },
    config.repository?.mongo?.collectionName ?? 'elysia_memories',
  )
  activeMongoConnection = lazy
  return ({ logger }) => {
    const repository = new MongoMemoryRepository(lazy.collection as MongoMemoryCollection, {
      collectionName: config.repository?.mongo?.collectionName,
      ensureIndexes: config.repository?.mongo?.indexes,
    })
    // 惰性连接：索引建立失败（如 Mongo 不可达）记录而非抛出未捕获 rejection。
    void repository.ensureIndexes().catch((error) => {
      logger.error('failed to ensure mongo indexes', error, { plugin: 'elysia-ai-memory', phase: 'ensure-indexes' })
    })
    return repository
  }
}

export function validateMemoryRepositoryConfig(config: MemoryPluginConfig): void {
  const repositoryType = config.repository?.type ?? 'memory'
  if (repositoryType === 'memory') return
  if (repositoryType === 'mongo') {
    if (!config.repositoryFactory && !config.repository?.mongo?.uri) {
      throw new Error('elysia-ai-memory: mongo repository requires mongo.uri or an injected repositoryFactory')
    }
    return
  }
  throw new Error(`elysia-ai-memory: unknown repository provider type "${repositoryType}"`)
}


export function preflightMemoryConfig(config: MemoryPluginConfig) {
  try {
    validateMemoryRepositoryConfig(config)
    const repositoryType = config.repository?.type ?? 'memory'
    const warnings = repositoryType === 'memory'
      ? [issue('elysia-ai-memory', 'memory.repository.memory-default', 'warning', 'memory plugin uses in-memory repository; data is not persistent', { repositoryType: 'memory' })]
      : []
    return createPreflightResult(warnings, {
      plugin: 'elysia-ai-memory',
      repositoryType,
      persistent: repositoryType === 'mongo',
    })
  } catch (error) {
    return createPreflightResult([
      issue('elysia-ai-memory', 'repository.invalid', 'error', error instanceof Error ? error.message : String(error), {
        repositoryType: config.repository?.type ?? 'memory',
      }),
    ], { plugin: 'elysia-ai-memory' })
  }
}

export const name = 'elysia-ai-memory'

export const Config: Schema<MemoryConfig> = Schema.intersect([
  Schema.object({
    enabled: Schema.boolean().default(true).description('启用记忆能力。'),
    contextLimit: Schema.number().default(5).description('注入对话的记忆条数上限。'),
    maxEntriesPerLife: Schema.number().description('每个生命体的记忆条数上限（留空不限制）。'),
  }).description('基础设置'),
  Schema.object({
    repository: Schema.object({
      type: Schema.union([
        Schema.const('memory' as const),
        Schema.const('mongo' as const),
      ]).default('memory').description('仓储类型：memory 为内存（重启即丢，适合开发）；mongo 为持久化。'),
      mongo: Schema.object({
        uri: Schema.string().role('secret').description('MongoDB 连接 URL（用户自部署）。填写后即启用 mongo 仓储。'),
        database: Schema.string().description('MongoDB 数据库名（默认 elysia_ai）。'),
        collectionName: Schema.string().description('Mongo 集合名。'),
        indexes: Schema.boolean().default(true).description('启动时确保 Mongo 索引。'),
      }).description('Mongo 仓储选项。'),
    }).description('仓储配置。'),
  }).description('高级：持久化仓储'),
])


function resolveMemoryRepositoryFactory(config: MemoryPluginConfig, logger: ReturnType<Context['logger']>) {
  try {
    validateMemoryRepositoryConfig(config)
  } catch (error) {
    logger.error('invalid memory repository configuration', error, {
      plugin: 'elysia-ai-memory',
      phase: 'apply',
      repositoryType: config.repository?.type ?? 'memory',
      collectionName: config.repository?.mongo?.collectionName ?? 'elysia_memories',
    })
    throw error
  }
  // 优先用宿主注入的工厂；否则若配了 mongo.uri，用内建惰性连接工厂。
  return config.repositoryFactory ?? buildUriRepositoryFactory(config)
}

export function apply(ctx: Context, config: MemoryPluginConfig) {
  const logger = ctx.logger('elysia-ai-memory')
  const runtime = getRequiredElysiaService<{
    context: { eventBus: EventBus<CoreEventMap> }
    memoryRepository?: MemoryRepository
    memoryService?: MemoryService
    memoryContextProvider?: MemoryContextProvider
  }>(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    logger,
    plugin: 'elysia-ai-memory',
    description: 'runtime service',
  })

  if (!runtime?.context?.eventBus) return

  activeMongoConnection = undefined
  const memoryRuntime = createMemoryPluginRuntime({
    runtime,
    config,
    logger,
    repositoryFactory: resolveMemoryRepositoryFactory(config, logger),
  })
  if (!memoryRuntime) return
  const mongoConnection = activeMongoConnection
  activeMongoConnection = undefined

  registerElysiaService(ctx, {
    formalName: 'elysia.memory',
    legacyName: 'elysia-ai-memory',
    service: memoryRuntime.service,
    logger,
    plugin: 'elysia-ai-memory',
  })

  runtime.memoryRepository = memoryRuntime.repository
  runtime.memoryService = memoryRuntime.memoryService
  runtime.memoryContextProvider = memoryRuntime.contextProvider

  ctx.on('dispose', () => {
    memoryRuntime.dispose()
    if (mongoConnection) {
      void mongoConnection.close().catch((error) => {
        logger.error('failed to close mongo connection', error, { plugin: 'elysia-ai-memory', phase: 'dispose' })
      })
    }
    if (runtime.memoryRepository === memoryRuntime.repository) runtime.memoryRepository = undefined
    if (runtime.memoryService === memoryRuntime.memoryService) runtime.memoryService = undefined
    if (runtime.memoryContextProvider === memoryRuntime.contextProvider) runtime.memoryContextProvider = undefined
  })
}
