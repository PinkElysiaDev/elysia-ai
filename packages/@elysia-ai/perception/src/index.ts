import type {
  BrainService,
  CapabilityDiagnostics,
  CoreEventMap,
  PerceptionService,
  Stimulus,
  PerceptionResult,
  EventBus,
} from '@elysia-ai/core'
import { NS_PERCEPTION, STAGE_PERCEPTION } from '@elysia-ai/core'
import { analyzeStimulus } from './rules.js'

export const internalName = 'elysia-ai-perception'

export interface Config {
  enabledIntentClassify: boolean
  enabledEntityExtract: boolean
  enabledSentiment: boolean
}

// ─── Plugin apply ───

type PerceptionLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface PerceptionPluginRuntimeOptions {
  /** perception 以阶段钩子装配（单轨）；事件仅作事实通知。 */
  runtime: { context: { eventBus: EventBus<CoreEventMap>, pipeline?: import('@elysia-ai/core').PipelineRunner<unknown> } }
  brain?: BrainService
  config: Config
  logger: PerceptionLoggerLike
}

export interface PerceptionPluginRuntime {
  service: PerceptionService
  dispose(): void
}

export function createPerceptionPluginRuntime(options: PerceptionPluginRuntimeOptions): PerceptionPluginRuntime {
  const { runtime, brain, config, logger } = options

  logger.info('perception plugin apply started', {
    plugin: 'elysia-ai-perception',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus

  const service: PerceptionService = {
    async process(stimulus: Stimulus): Promise<PerceptionResult> {
      // 触发器重构后逐条 AI 感知与批量 LLM 唤醒冗余，回归纯规则版富化
      // （意图标签 + tokenCount 供事件清单行使用）。
      return analyzeStimulus(stimulus, config)
    },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-perception',
        enabled: true,
        ready: true,
        serviceName: 'elysia.perception',
        metadata: {
          hasBrainService: Boolean(brain),
        },
      }
    },
  }

  const disposeStimulus = (() => {
    const handleStimulus = async (stimulus: Stimulus, writeResult?: (result: PerceptionResult) => void): Promise<void> => {
      const stimulusId = stimulus.id
      // W3：触发器合成刺激（metadata.triggerSource）直接跳过分析——
      // 其 payload 是定向指令而非用户话语，规则富化（意图/实体/情感）
      // 对它无意义，写 NS_PERCEPTION / 发 perception.completed 只会
      // 给下游投喂噪声（cognition 事件清单/事件计数）。
      if ((stimulus.metadata as Record<string, unknown> | undefined)?.triggerSource) {
        logger.debug('perception skipped synthetic trigger stimulus', {
          plugin: 'elysia-ai-perception',
          phase: 'perception',
          stimulusId,
          triggerSource: (stimulus.metadata as Record<string, unknown>).triggerSource,
        })
        return
      }
      logger.debug('perception analyzing stimulus', {
        plugin: 'elysia-ai-perception',
        phase: 'perception',
        event: 'stimulus.received',
        stimulusId,
        type: stimulus.type,
        actorId: stimulus.actorId,
      })

      try {
        const result = await service.process(stimulus)

        logger.info('perception completed', {
          plugin: 'elysia-ai-perception',
          phase: 'perception',
          stimulusId,
          intent: result.intent.primary,
          intentConfidence: result.intent.confidence,
          entityCount: result.entities.length,
          sentiment: result.sentiment.label,
          tokenCount: result.context.tokenCount,
          mode: result.metadata?.mode,
          aiRequested: result.metadata?.aiRequested,
          aiSucceeded: result.metadata?.aiSucceeded,
        })

        // 管线模式下把结果写入共享上下文，供下游 cognition/behavior
        // 直接读取（替代各自的私有 BoundedCache 侧信道）。
        writeResult?.(result)

        await eventBus.emit('perception.completed', {
          stimulusId,
          result,
        })
      } catch (error) {
        // service.process 仅在 aiEnhanced 且 aiFallbackToRuleBased=false 的 AI 失败时抛出。
        // 此处显式记录，避免感知失败被静默吞掉、让下游 cognition/behavior 无从感知。
        logger.error('perception failed; downstream cognition/behavior will not receive this stimulus', error, {
          plugin: 'elysia-ai-perception',
          phase: 'perception',
          event: 'stimulus.received',
          stimulusId,
          type: stimulus.type,
          actorId: stimulus.actorId,
        })
      }
    }

    // 钩子装配（kernel 管线阶段）。主链单轨：处理走钩子，
    // stimulus.received 事件只作为事实通知保留（观测类消费者）。
    const pipeline = runtime.context.pipeline
    return pipeline.registerHook({
      stage: STAGE_PERCEPTION,
      owner: 'elysia-ai-perception',
      async run(pctx) {
        const stimulus = (pctx.core as { stimulus: Stimulus }).stimulus
        await handleStimulus(stimulus, (result) => pctx.write(NS_PERCEPTION, result))
      },
    })
  })()

  return {
    service,
    dispose() {
      disposeStimulus()
      logger.info('perception plugin disposed', {
        plugin: 'elysia-ai-perception',
        phase: 'dispose',
      })
    },
  }
}
