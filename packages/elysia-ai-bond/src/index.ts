import { Schema, type Context } from 'koishi'
import { createBondPluginRuntime, MemoryBondRepository, MongoBondRepository } from '@elysia-ai/bond'
import type { BondRepository } from '@elysia-ai/core'
import type { Config as BondConfig, BondRepositoryFactoryOptions, MongoBondCollection } from '@elysia-ai/bond'
import type { CoreEventMap, EventBus, PersistenceService } from '@elysia-ai/core'
import {
  createElysiaPlugin,
  getOptionalElysiaService,
} from '@elysia-ai/shared'
export * from '@elysia-ai/bond'


type BondPluginConfig = BondConfig & {
  repositoryFactory?: (options: BondRepositoryFactoryOptions) => BondRepository
}


export function createMongoBondRepositoryFactory(
  collection: MongoBondCollection,
  options: { collectionName?: string; ensureIndexes?: boolean } = {},
): (factoryOptions: BondRepositoryFactoryOptions) => BondRepository {
  return ({ logger }) => {
    const repository = new MongoBondRepository(collection, options)
    // 惰性连接：索引建立失败（如 Mongo 不可达）记录而非抛出未捕获 rejection。
    void repository.ensureIndexes().catch((error) => {
      logger.error('failed to ensure mongo indexes', error, { plugin: 'elysia-ai-bond', phase: 'ensure-indexes' })
    })
    return repository
  }
}

export const name = 'elysia-ai-bond'

// 声明对 runtime 的必需依赖：cordis 会在 elysia.runtime 就绪后再跑本插件 apply。
export const inject = ['elysia.runtime']

export const Config: Schema<BondConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用羁绊（关系）能力。'),
  contextLimit: Schema.number().default(5).description('注入对话的羁绊条数上限。'),
})

/**
 * 解析羁绊仓储工厂：
 * 1. 若宿主注入了 repositoryFactory，优先用它（测试/自定义场景）。
 * 2. 否则从 elysia.persistence 服务获取：mongo 模式拿到 collection 句柄 → 建 mongo 仓储；
 *    memory 模式或服务未注册 → 内存降级。
 */
function resolveBondRepositoryFactory(
  config: BondPluginConfig,
  ctx: Context,
  logger: ReturnType<Context['logger']>,
): (options: BondRepositoryFactoryOptions) => BondRepository {
  if (config.repositoryFactory) return config.repositoryFactory

  const persistence = getOptionalElysiaService<PersistenceService>(ctx, {
    formalName: 'elysia.persistence',
  })

  const collection = persistence?.getCollection('elysia_bonds')
  if (persistence && collection) {
    logger.info('bond repository resolved from persistence service', {
      plugin: 'elysia-ai-bond',
      phase: 'repository-resolve',
      mode: persistence.mode,
    })
    return createMongoBondRepositoryFactory(collection as unknown as MongoBondCollection, { ensureIndexes: true })
  }

  logger.info('bond repository falling back to in-memory', {
    plugin: 'elysia-ai-bond',
    phase: 'repository-resolve',
    persistenceMode: persistence?.mode ?? 'unavailable',
  })
  return () => new MemoryBondRepository()
}

type BondRuntimeShape = {
  context: { eventBus: EventBus<CoreEventMap> }
}

// 工厂 v2 装配：仓储解析在 build() 内完成，
// manifest 注册/注销由工厂统一托管。
export const apply = createElysiaPlugin<BondPluginConfig, BondRuntimeShape, ReturnType<typeof createBondPluginRuntime>['service']>({
  name: 'elysia-ai-bond',
  serviceFormalName: 'elysia.bond',
  runtimeDescription: 'runtime service',
  manifest: {
    name: 'elysia-ai-bond',
    version: '0.2.0',
    services: { provides: ['elysia.bond'], consumes: ['elysia.runtime'] },
    configNamespace: 'bond',
  },
  build({ ctx, runtime, config, logger }) {
    const bondRuntime = createBondPluginRuntime({
      runtime,
      config,
      logger,
      repositoryFactory: resolveBondRepositoryFactory(config, ctx, logger),
    })
    if (!bondRuntime) return undefined

    return {
      service: bondRuntime.service,
      dispose() {
        bondRuntime.dispose()
        // 不再 close mongo 连接：持久化连接生命周期由 runtime 的 stateRepository 统一管理。
      },
    }
  },
})
