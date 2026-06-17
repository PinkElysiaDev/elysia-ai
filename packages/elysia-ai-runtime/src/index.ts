import { Context, Schema } from 'koishi'
import { createDefaultRuntime, type Runtime } from './runtime.js'
import { loadManifestFromFile } from './manifest/loader.js'
import type { RuntimeLogger } from './context/index.js'
import { registerElysiaService } from '@elysia-ai/shared'
import {
  createRuntimeStateRepository,
  type RuntimeStateRepositoryConfig,
  type RuntimeStateRepositorySetup,
} from './store/runtime-state-repository.js'

export const name = 'elysia-ai-runtime'

export interface Config {
  /**
   * 闂備焦鐪归崹濠氬窗鎼淬劌绠犻柍鈺佸暞婵挳鏌熼幆褏锛嶉柡澶庢閵嗘帒顫濋澶婂壈闂佹寧绋掗崝娆忣嚕閻楀牊鍎熼柕濞垮劚鐠у绱撻崒姘灓闁哥姵顨婂鎼佸礃閳哄喚娴勯梺璇″灡婢瑰棝鎮㈤崨顖楀亾閸偅绶查悗姘憸濡叉劕顫滈埊绺奛 闂備礁鎼粔鍫曞储瑜忓Σ鎰版晸閻樿櫕娅?   * 闂備椒绱徊楣冩偡瑜旈崺鐐哄冀椤撶偟顦┑鐐叉濞寸兘鎮峰┑瀣厱闁哄啫鍊搁瀷濠电偞娼欏ú锔剧矉閹烘梹濯肩€规洖娲ㄥ崗濠碘槅鍋呭妯尖偓姘煎灦椤㈡瑩寮撮姀鈥充缓闂佺粯妫冮弨閬嶅吹閹烘嚚?   */
  manifestPath?: string

  /**
   * 闂備焦鐪归崹濠氬窗鎼淬劌绠犻柨鐔哄У閸嬫劙鏌ら崫銉毌闁稿鎸婚幏鍛槹鎼淬垹鐨鹃梻浣侯焾鐞氼偊宕濋幋锕€鍌ㄩ柕鍫濇川绾?   *
   * 濠殿喗甯楃粙鎺椻€﹂崼銉晣缂備焦蓱婵挳鎮归幁鎺戝闁?memory闂備線娼уΛ鏃堝箞缁屾獢go 婵犵妲呴崹顏堝焵椤掆偓绾绢厾娑甸埀顒勬⒑?runtime 闂備礁婀辩划顖滄暜婵犲倵鏋庨柕蹇嬪灪鐎氬鏌ｉ弮鍥у惞闁绘挻鍨垮鍫曞煛閸愩劋娌柣銏╁灡閹告娊骞冩禒瀣亜闂佸灝顑呭▓銉╂⒑閸涘﹦鈼ら柛鏂跨Т閿曘垽鍩勯崘顏佹灃闁硅壈鎻徊浠嬪磻瀹ュ洠鍋撳▓鍨灍婵炲弶鐗犲畷褰掑垂椤愶絽寮块柣搴秵娴滄粓顢氳閺?   */
  stateRepository?: RuntimeStateRepositoryConfig
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    manifestPath: Schema.string()
      .description('生命体清单 JSON 文件路径。留空则不加载预设生命体。'),
  }).description('基础设置'),
  Schema.object({
    stateRepository: Schema.object({
      type: Schema.union(['memory', 'mongo'])
        .default('memory')
        .description('生命状态仓储类型：memory 用于开发/测试；mongo 用于持久化状态。'),
      mongo: Schema.object({
        uri: Schema.string()
          .role('secret')
          .description('MongoDB 连接 URI。当 type 为 mongo 时必填。'),
        database: Schema.string()
          .default('elysia_ai')
          .description('MongoDB 数据库名。'),
        collection: Schema.string()
          .default('life_states')
          .description('MongoDB 集合名。'),
        stateType: Schema.string()
          .default('homeostasis')
          .description('状态类型分区键。'),
        failFast: Schema.boolean()
          .default(false)
          .description('Mongo 初始化失败时是否中止 runtime 插件加载。'),
      }).description('MongoDB 生命状态仓储配置。'),
    }).description('生命状态仓储配置。'),
  }).description('高级：状态持久化'),
])
export * from './context/index.js'
export * from './runtime.js'
export * from './registry/life-registry.js'
export * from './registry/habitat-registry.js'
export * from './registry/memory-life-registry.js'
export * from './registry/memory-habitat-registry.js'
export * from './registry/memory-persona-registry.js'
export * from './store/memory-conversation-store.js'
export * from './store/memory-state-repository.js'
export * from './store/mongo-state-repository.js'
export * from './store/runtime-state-repository.js'
export * from './scheduler/index.js'
export * from './scheduler/mongo-scheduled-task-repository.js'
export * from './behavior-execution/index.js'
export * from './homeostasis/index.js'
export * from './lifecycle/index.js'
export * from './manifest/index.js'
export * from './projection/registry.js'
export * from './projection/default-resolver.js'
export * from './projection/memory-projection-rule-repository.js'
export * from './projection/mongo-projection-rule-repository.js'
export * from './projection/projection-rule-service.js'

// Extend Koishi Context with runtime compatibility field.
declare module 'koishi' {
  interface Context {
    'elysia.runtime'?: Runtime
    'elysia-ai-runtime'?: Runtime
  }
}

export async function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('elysia-ai-runtime')

  logger.info('runtime plugin apply started', {
    plugin: 'elysia-ai-runtime',
    phase: 'apply',
    hasManifestPath: Boolean(config.manifestPath),
    stateRepositoryType: config.stateRepository?.type ?? 'memory',
  })

  const runtimeLogger: RuntimeLogger = {
    info(message, meta) {
      logger.info(message, meta)
    },
    debug(message, meta) {
      logger.debug(message, meta)
    },
    error(message, error, meta) {
      if (meta && error) {
        logger.error(message, meta, error)
        return
      }
      if (error) {
        logger.error(message, error)
        return
      }
      if (meta) {
        logger.error(message, meta)
        return
      }
      logger.error(message)
    },
  }

  let stateRepositorySetup: RuntimeStateRepositorySetup
  try {
    stateRepositorySetup = await createRuntimeStateRepository(config.stateRepository, runtimeLogger)
  } catch (error) {
    logger.error('failed to initialize runtime state repository', error, {
      plugin: 'elysia-ai-runtime',
      phase: 'state-repository',
    })
    return
  }

  const runtime = createDefaultRuntime({
    logger: runtimeLogger,
    stateRepository: stateRepositorySetup.repository,
  })

  registerElysiaService(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    service: runtime,
    logger: runtimeLogger,
    plugin: 'elysia-ai-runtime',
  })

  logger.debug('runtime instance attached to context', {
    plugin: 'elysia-ai-runtime',
    phase: 'apply',
  })

  // 闂備礁鎲￠崙褰掑垂閻楀牊鍙?runtime
  try {
    await runtime.start()
  } catch (error) {
    logger.error('failed to start runtime', error)
    try {
      await stateRepositorySetup.dispose()
    } catch (disposeError) {
      logger.error('failed to dispose state repository after runtime start failure', disposeError, {
        plugin: 'elysia-ai-runtime',
        phase: 'dispose',
      })
    }
    return
  }

  if (config.manifestPath) {
    try {
      logger.info('manifest loading requested', {
        plugin: 'elysia-ai-runtime',
        phase: 'manifest',
        manifestPath: config.manifestPath,
      })

      const manifest = await loadManifestFromFile(config.manifestPath)
      await runtime.loadManifest(manifest)
      logger.info('manifest loading completed', {
        plugin: 'elysia-ai-runtime',
        phase: 'manifest',
        lifeInstanceCount: manifest.lifeInstances.length,
      })
    } catch (error) {
      logger.error('failed to load manifest', error, {
        plugin: 'elysia-ai-runtime',
        phase: 'manifest',
        manifestPath: config.manifestPath,
      })
    }
  }

  ctx.on('dispose', async () => {
    try {
      await runtime.stop()
    } catch (error) {
      logger.error('failed to stop runtime', error, {
        plugin: 'elysia-ai-runtime',
        phase: 'dispose',
      })
    }

    try {
      await stateRepositorySetup.dispose()
    } catch (error) {
      logger.error('failed to dispose state repository', error, {
        plugin: 'elysia-ai-runtime',
        phase: 'dispose',
      })
    }
  })
}
