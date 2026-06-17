import { Schema, type Context } from 'koishi'
import { createBondPluginRuntime, MongoBondRepository } from '@elysia-ai/bond'
import type { Config as BondConfig, BondRepositoryFactoryOptions, MongoBondCollection, MongoBondRepositoryOptions } from '@elysia-ai/bond'
import type { BondContextProvider, BondRepository, BondService, CoreEventMap, EventBus } from '@elysia-ai/core'
import {
  createPreflightResult,
  getRequiredElysiaService,
  issue,
  lazyMongoCollection,
  registerElysiaService,
  type LazyMongoCollection,
} from '@elysia-ai/shared'
export * from '@elysia-ai/bond'


type BondPluginConfig = BondConfig & {
  repositoryFactory?: (options: BondRepositoryFactoryOptions) => BondRepository
}


export function createMongoBondRepositoryFactory(
  collection: MongoBondCollection,
  options: MongoBondRepositoryOptions = {},
): (factoryOptions: BondRepositoryFactoryOptions) => BondRepository {
  return () => {
    const repository = new MongoBondRepository(collection, options)
    void repository.ensureIndexes()
    return repository
  }
}

// 内建惰性 Mongo 连接的句柄（供 dispose 关闭）。按 apply 调用作用域追踪。
let activeMongoConnection: LazyMongoCollection<{ id: string }> | undefined

/**
 * 用配置的 mongo.uri 内建仓储工厂（惰性连接，首次读写才连库）。
 * 宿主只需给 URL，无需自己注入 repositoryFactory。返回 undefined 表示未配 uri。
 */
function buildUriRepositoryFactory(
  config: BondPluginConfig,
): ((options: BondRepositoryFactoryOptions) => BondRepository) | undefined {
  const uri = config.repository?.mongo?.uri
  if (!uri) return undefined
  const lazy = lazyMongoCollection<{ id: string }>(
    { uri, database: config.repository?.mongo?.database },
    config.repository?.mongo?.collectionName ?? 'elysia_bonds',
  )
  activeMongoConnection = lazy
  return ({ logger }) => {
    const repository = new MongoBondRepository(lazy.collection as MongoBondCollection, {
      collectionName: config.repository?.mongo?.collectionName,
      ensureIndexes: config.repository?.mongo?.indexes,
    })
    // 惰性连接：索引建立失败（如 Mongo 不可达）记录而非抛出未捕获 rejection。
    void repository.ensureIndexes().catch((error) => {
      logger.error('failed to ensure mongo indexes', error, { plugin: 'elysia-ai-bond', phase: 'ensure-indexes' })
    })
    return repository
  }
}

export function validateBondRepositoryConfig(config: BondPluginConfig): void {
  const repositoryType = config.repository?.type ?? 'memory'
  if (repositoryType === 'memory') return
  if (repositoryType === 'mongo') {
    if (!config.repositoryFactory && !config.repository?.mongo?.uri) {
      throw new Error('elysia-ai-bond: mongo repository requires mongo.uri or an injected repositoryFactory')
    }
    return
  }
  throw new Error(`elysia-ai-bond: unknown repository provider type "${repositoryType}"`)
}


export function preflightBondConfig(config: BondPluginConfig) {
  try {
    validateBondRepositoryConfig(config)
    const repositoryType = config.repository?.type ?? 'memory'
    const warnings = repositoryType === 'memory'
      ? [issue('elysia-ai-bond', 'bond.repository.memory-default', 'warning', 'bond plugin uses in-memory repository; relationship data is not persistent', { repositoryType: 'memory' })]
      : []
    return createPreflightResult(warnings, {
      plugin: 'elysia-ai-bond',
      repositoryType,
      persistent: repositoryType === 'mongo',
    })
  } catch (error) {
    return createPreflightResult([
      issue('elysia-ai-bond', 'repository.invalid', 'error', error instanceof Error ? error.message : String(error), {
        repositoryType: config.repository?.type ?? 'memory',
      }),
    ], { plugin: 'elysia-ai-bond' })
  }
}

export const name = 'elysia-ai-bond'

export const Config: Schema<BondConfig> = Schema.intersect([
  Schema.object({
    enabled: Schema.boolean().default(true).description('启用羁绊（关系）能力。'),
    contextLimit: Schema.number().default(5).description('注入对话的羁绊条数上限。'),
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


function resolveBondRepositoryFactory(config: BondPluginConfig, logger: ReturnType<Context['logger']>) {
  try {
    validateBondRepositoryConfig(config)
  } catch (error) {
    logger.error('invalid bond repository configuration', error, {
      plugin: 'elysia-ai-bond',
      phase: 'apply',
      repositoryType: config.repository?.type ?? 'memory',
      collectionName: config.repository?.mongo?.collectionName ?? 'elysia_bonds',
    })
    throw error
  }
  // 优先用宿主注入的工厂；否则若配了 mongo.uri，用内建惰性连接工厂。
  return config.repositoryFactory ?? buildUriRepositoryFactory(config)
}

export function apply(ctx: Context, config: BondPluginConfig) {
  const logger = ctx.logger('elysia-ai-bond')
  const runtime = getRequiredElysiaService<{
    context: { eventBus: EventBus<CoreEventMap> }
    bondRepository?: BondRepository
    bondService?: BondService
    bondContextProvider?: BondContextProvider
  }>(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    logger,
    plugin: 'elysia-ai-bond',
    description: 'runtime service',
  })

  if (!runtime?.context?.eventBus) return

  activeMongoConnection = undefined
  const bondRuntime = createBondPluginRuntime({
    runtime,
    config,
    logger,
    repositoryFactory: resolveBondRepositoryFactory(config, logger),
  })
  if (!bondRuntime) return
  const mongoConnection = activeMongoConnection
  activeMongoConnection = undefined

  registerElysiaService(ctx, {
    formalName: 'elysia.bond',
    legacyName: 'elysia-ai-bond',
    service: bondRuntime.service,
    logger,
    plugin: 'elysia-ai-bond',
  })

  runtime.bondRepository = bondRuntime.repository
  runtime.bondService = bondRuntime.bondService
  runtime.bondContextProvider = bondRuntime.contextProvider

  ctx.on('dispose', () => {
    bondRuntime.dispose()
    if (mongoConnection) {
      void mongoConnection.close().catch((error) => {
        logger.error('failed to close mongo connection', error, { plugin: 'elysia-ai-bond', phase: 'dispose' })
      })
    }
    if (runtime.bondRepository === bondRuntime.repository) runtime.bondRepository = undefined
    if (runtime.bondService === bondRuntime.bondService) runtime.bondService = undefined
    if (runtime.bondContextProvider === bondRuntime.contextProvider) runtime.bondContextProvider = undefined
  })
}
