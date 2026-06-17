import type {
  BrainService,
  CapabilityDiagnostics,
  CognitionService,
  CognitionContext,
  CoreEventMap,
  EventBus,
  HomeostasisState,
  PerceptionResult,
  PersonaRegistry,
  ConversationStore,
  Stimulus,
} from '@elysia-ai/core'
import { BoundedCache } from '@elysia-ai/shared'
import { reasonWithAi } from './ai-enhanced.js'

export const internalName = 'elysia-ai-cognition'

export interface Config {
  recentConversationLimit: number
  salienceDirectMentionBonus: number
  salienceDirectMessageBonus: number
  salienceReplyBonus: number
  salienceQuestionBonus: number
  salienceLengthFactor: number
  behaviorThreshold: number
  aiEnhanced: boolean
  aiFallbackToRuleBased: boolean
  aiMinSalience: number
  aiModelSlot: string
}

function resolveScopeKey(stimulus: Stimulus): string {
  if (stimulus.threadId) return `thread:${stimulus.threadId}`
  if (stimulus.channelId) return `channel:${stimulus.channelId}`
  return `habitat:${stimulus.habitatId}`
}

function buildCognitionContext(
  stimulus: Stimulus,
  personaRegistry: PersonaRegistry,
  conversationStore: ConversationStore,
  config: Config,
  perception?: PerceptionResult,
  homeostasis?: HomeostasisState,
): CognitionContext {
  const scopeKey = resolveScopeKey(stimulus)
  const lifeId = stimulus.lifeId
  const persona = lifeId ? personaRegistry.getByLifeId(lifeId) : undefined
  const recentConversation = conversationStore.getRecent(scopeKey, config.recentConversationLimit)

  return {
    stimulusId: stimulus.id,
    lifeId,
    habitatId: stimulus.habitatId,
    actorId: stimulus.actorId,
    threadId: stimulus.threadId,
    scopeKey,
    stimulus,
    persona,
    perception,
    homeostasis,
    recentConversation,
  }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Plugin apply
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type CognitionLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface CognitionPluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap> }
    personaRegistry: PersonaRegistry
    conversationStore: ConversationStore
  }
  brain?: BrainService
  config: Config
  logger: CognitionLoggerLike
}

export interface CognitionPluginRuntime {
  service: CognitionService
  dispose(): void
}

export function createCognitionPluginRuntime(options: CognitionPluginRuntimeOptions): CognitionPluginRuntime {
  const { runtime, brain, config, logger } = options

  logger.info('cognition plugin apply started', {
    plugin: 'elysia-ai-cognition',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const service: CognitionService = {
    async reason(context: CognitionContext) {
      return reasonWithAi(context, config, brain, logger)
    },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-cognition',
        enabled: true,
        ready: true,
        serviceName: 'elysia.cognition',
        metadata: {
          aiEnhanced: config.aiEnhanced,
          hasBrainService: Boolean(brain),
        },
      }
    },
  }
  const stimulusCache = new BoundedCache<string, Stimulus>()
  const perceptionCache = new BoundedCache<string, PerceptionResult>()
  const homeostasisCache = new Map<string, HomeostasisState>()

  const disposeStimulus = eventBus.on('stimulus.received', ({ stimulusId, stimulus }) => {
    stimulusCache.set(stimulusId, stimulus)
  })

  const disposePerception = eventBus.on('perception.completed', ({ stimulusId, result }) => {
    perceptionCache.set(stimulusId, result)
  })

  const disposeHomeostasis = eventBus.on('homeostasis.updated', ({ lifeInstanceId, state }) => {
    homeostasisCache.set(lifeInstanceId, state)
  })

  const disposeProjection = eventBus.on('projection.routed', async ({ stimulusId, routing }) => {
    const stimulus = stimulusCache.get(stimulusId)

    if (!stimulus) {
      logger.error('stimulus not found in cache for cognition reasoning', {
        plugin: 'elysia-ai-cognition',
        phase: 'cognition',
        stimulusId,
      })
      return
    }

    if (routing.lifeIds.length === 0) {
      logger.debug('no life matched for stimulus, skipping cognition reasoning', {
        plugin: 'elysia-ai-cognition',
        phase: 'cognition',
        stimulusId,
        reason: routing.reason,
      })
      return
    }

    const perception = perceptionCache.get(stimulusId)

    for (const lifeId of routing.lifeIds) {
      const lifeStimulus: Stimulus = { ...stimulus, lifeId }
      const homeostasis = homeostasisCache.get(lifeId)

      logger.debug('cognition reasoning started', {
        plugin: 'elysia-ai-cognition',
        phase: 'cognition',
        event: 'projection.routed',
        stimulusId,
        lifeId,
        type: stimulus.type,
        actorId: stimulus.actorId,
        hasPerception: Boolean(perception),
        hasHomeostasis: Boolean(homeostasis),
      })

      const cognitionContext = buildCognitionContext(
        lifeStimulus,
        runtime.personaRegistry,
        runtime.conversationStore,
        config,
        perception,
        homeostasis,
      )

      await eventBus.emit('cognition.reasoning', {
        stimulusId,
        lifeId: cognitionContext.lifeId,
        scopeKey: cognitionContext.scopeKey,
      })

      const result = await service.reason(cognitionContext)

      logger.info('cognition completed', {
        plugin: 'elysia-ai-cognition',
        phase: 'cognition',
        stimulusId,
        lifeId: result.lifeId,
        scopeKey: result.scopeKey,
        salience: result.salience,
        continuity: result.continuity,
        shouldEnterBehavior: result.shouldEnterBehavior,
        reason: result.reason,
        mode: result.metadata?.mode,
      })

      await eventBus.emit('cognition.completed', result)
    }
  })

  return {
    service,
    dispose() {
      disposeStimulus()
      disposePerception()
      disposeHomeostasis()
      disposeProjection()
      stimulusCache.clear()
      perceptionCache.clear()
      homeostasisCache.clear()
      logger.info('cognition plugin disposed', {
        plugin: 'elysia-ai-cognition',
        phase: 'dispose',
      })
    },
  }
}
