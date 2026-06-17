import type {
  BrainService,
  CapabilityDiagnostics,
  CoreEventMap,
  PerceptionService,
  Stimulus,
  PerceptionResult,
  EventBus,
} from '@elysia-ai/core'
import { analyzeStimulusWithAi } from './ai-enhanced.js'

export const internalName = 'elysia-ai-perception'

export interface Config {
  maxInputTokens: number
  enabledIntentClassify: boolean
  enabledEntityExtract: boolean
  enabledSentiment: boolean
  aiEnhanced: boolean
  aiFallbackToRuleBased: boolean
  aiMinTextLength: number
  aiModelSlot: string
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Plugin apply
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type PerceptionLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface PerceptionPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> } }
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
      return analyzeStimulusWithAi(stimulus, config, brain, logger)
    },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-perception',
        enabled: true,
        ready: true,
        serviceName: 'elysia.perception',
        metadata: {
          aiEnhanced: config.aiEnhanced,
          hasBrainService: Boolean(brain),
        },
      }
    },
  }

  const disposeStimulus = eventBus.on('stimulus.received', async ({ stimulusId, stimulus }) => {
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
  })

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
