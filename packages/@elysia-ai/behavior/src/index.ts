import type {
  BehaviorExecutionService,
  BehaviorService,
  CapabilityDiagnostics,
  CognitionResult,
  CoreEventMap,
  EventBus,
  HomeostasisState,
  PerceptionResult,
  Persona,
  Stimulus,
} from '@elysia-ai/core'
import { BoundedCache, clampPercent } from '@elysia-ai/shared'
import { resolveStimulusScope } from './scope.js'
import { calculateStimulusSignal } from './signals.js'
import { routeStimulus } from './router.js'
import { buildInstruction } from './action-builder.js'
import {
  createResponsePlanFromCandidate,
  generateBehaviorCandidates,
  selectBehaviorCandidate,
} from './candidates.js'
import { applyPersonaToSignal } from './persona-signal.js'
import { createBehaviorExecutionPlan } from './execution-plan.js'
import type {
  BehaviorPlanningContext,
  BehaviorPlannedEventPayload,
} from './types.js'

export const internalName = 'elysia-ai-behavior'

export interface Config {
  enableReply: boolean
  directWindowMs: number
  userBufferedWindowMs: number
  threadBufferedWindowMs: number
  habitatBufferedWindowMs: number
}

function createPlanningContext(
  stimulus: Stimulus,
  config: Config,
  options: {
    lifeId?: string
    perception?: PerceptionResult
    cognition?: CognitionResult
    homeostasis?: HomeostasisState
    persona?: Persona
  } = {},
): BehaviorPlanningContext {
  return {
    directWindowMs: config.directWindowMs,
    userBufferedWindowMs: config.userBufferedWindowMs,
    threadBufferedWindowMs: config.threadBufferedWindowMs,
    habitatBufferedWindowMs: config.habitatBufferedWindowMs,
    lifeId: options.lifeId,
    perception: options.perception,
    cognition: options.cognition,
    homeostasis: options.homeostasis,
    persona: options.persona,
    threadId: stimulus.threadId,
    now: Date.now(),
    bucketStimulusCount: 1,
  }
}

function getCognitionForLife(
  cache: BoundedCache<string, Map<string, CognitionResult>>,
  stimulusId: string,
  lifeId: string,
): CognitionResult | undefined {
  return cache.get(stimulusId)?.get(lifeId)
}

function shouldSkipByCognition(cognition?: CognitionResult): boolean {
  return cognition ? !cognition.shouldEnterBehavior : false
}

function applyLifeStateToSignal(
  signal: ReturnType<typeof calculateStimulusSignal>,
  context: BehaviorPlanningContext,
): ReturnType<typeof calculateStimulusSignal> {
  const perception = context.perception
  const cognition = context.cognition
  const homeostasis = context.homeostasis

  let responseNecessity = signal.responseNecessity
  let continuity = signal.continuity
  let directness = signal.directness

  if (perception?.intent.primary === 'greet') responseNecessity += 10
  if (perception?.intent.primary === 'question') responseNecessity += 20
  if (perception?.intent.primary === 'command') responseNecessity += 15
  if (perception?.sentiment.label === 'negative') responseNecessity += 10

  if (cognition) {
    responseNecessity += cognition.salience * 20
    continuity += cognition.continuity * 20
  }

  if (homeostasis) {
    const willingness = 1 - homeostasis.responseThreshold
    responseNecessity += (willingness - 0.5) * 30
    directness += (homeostasis.sociability - 0.5) * 10
  }

  return {
    ...signal,
    directness: clampPercent(directness),
    continuity: clampPercent(continuity),
    responseNecessity: clampPercent(responseNecessity),
  }
}

type BehaviorLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface BehaviorPluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap> }
    personaRegistry?: { getByLifeId(lifeId: string): Persona | undefined }
    behaviorExecution?: BehaviorExecutionService
  }
  config: Config
  logger: BehaviorLoggerLike
}

export interface BehaviorPluginRuntime {
  service: BehaviorService
  dispose(): void
}

export function createBehaviorPluginRuntime(options: BehaviorPluginRuntimeOptions): BehaviorPluginRuntime {
  const { runtime, config, logger } = options

  logger.info('behavior plugin apply started', {
    plugin: 'elysia-ai-behavior',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const service: BehaviorService = {
    async decide(stimulus, signalOverride = {}) {
      const context = createPlanningContext(stimulus, config, {})
      const scope = resolveStimulusScope(stimulus, context)
      const calculatedSignal = calculateStimulusSignal(stimulus, scope, context)
      const signal = { ...calculatedSignal, ...signalOverride }
      const decision = routeStimulus(signal)
      const candidates = generateBehaviorCandidates(scope, stimulus.id, decision, signal)
      return selectBehaviorCandidate(stimulus.id, candidates, signal)
    },
    createResponsePlan(decision) {
      const fallbackMode = typeof decision.selected.metadata?.mode === 'string'
        ? decision.selected.metadata.mode as any
        : 'program-direct'
      return createResponsePlanFromCandidate(decision.selected, fallbackMode)
    },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-behavior',
        enabled: true,
        ready: true,
        serviceName: 'elysia.behavior',
        metadata: {
          enableReply: config.enableReply,
        },
      }
    },
  }
  // 缂撳瓨鏈€杩戠殑 stimulus 涓庣敓鍛界姸鎬佷笂涓嬫枃锛屼緵 projection.routed 鍥炴煡
  const stimulusCache = new BoundedCache<string, Stimulus>()
  const perceptionCache = new BoundedCache<string, PerceptionResult>()
  const cognitionCache = new BoundedCache<string, Map<string, CognitionResult>>()
  const homeostasisCache = new Map<string, HomeostasisState>()

  const disposeStimulus = eventBus.on('stimulus.received', ({ stimulusId, stimulus }) => {
    stimulusCache.set(stimulusId, stimulus)
  })

  const disposePerception = eventBus.on('perception.completed', ({ stimulusId, result }) => {
    perceptionCache.set(stimulusId, result)
  })

  const disposeCognition = eventBus.on('cognition.completed', (result) => {
    if (!result.lifeId) return

    const byLife = cognitionCache.get(result.stimulusId) ?? new Map<string, CognitionResult>()
    byLife.set(result.lifeId, result)
    cognitionCache.set(result.stimulusId, byLife)
  })

  const disposeHomeostasis = eventBus.on('homeostasis.updated', ({ lifeInstanceId, state }) => {
    homeostasisCache.set(lifeInstanceId, state)
  })

  const disposeProjection = eventBus.on('projection.routed', async ({ stimulusId, routing }) => {
    const stimulus = stimulusCache.get(stimulusId)
    if (!stimulus) {
      logger.error('stimulus not found in cache for projection.routed', {
        plugin: 'elysia-ai-behavior',
        phase: 'planning',
        stimulusId,
      })
      return
    }

    // 鏃犲尮閰?life 鏃惰烦杩?behavior planning
    if (routing.lifeIds.length === 0) {
      logger.debug('no life matched for stimulus, skipping behavior planning', {
        plugin: 'elysia-ai-behavior',
        phase: 'planning',
        stimulusId,
        reason: routing.reason,
      })
      return
    }

    logger.debug('behavior planning triggered via projection.routed', {
      plugin: 'elysia-ai-behavior',
      phase: 'planning',
      event: 'projection.routed',
      stimulusId,
      habitatId: stimulus.habitatId,
      actorId: stimulus.actorId,
      type: stimulus.type,
      lifeIds: routing.lifeIds,
    })

    const perception = perceptionCache.get(stimulus.id)

    // 涓烘瘡涓尮閰嶇殑 life 鐙珛瑙勫垝
    for (const lifeId of routing.lifeIds) {
      const cognition = getCognitionForLife(cognitionCache, stimulus.id, lifeId)
      const homeostasis = homeostasisCache.get(lifeId)
      const persona = runtime.personaRegistry?.getByLifeId(lifeId)
      const planningContext = createPlanningContext(stimulus, config, {
        lifeId,
        perception,
        cognition,
        homeostasis,
        persona,
      })

      if (shouldSkipByCognition(cognition)) {
        logger.debug('cognition gate rejected behavior planning', {
          plugin: 'elysia-ai-behavior',
          phase: 'planning',
          stimulusId: stimulus.id,
          lifeId,
          salience: cognition?.salience,
          continuity: cognition?.continuity,
          reason: cognition?.reason,
        })
        continue
      }

      const scope = resolveStimulusScope(stimulus, planningContext)
      const signal = calculateStimulusSignal(stimulus, scope, planningContext)
      const lifeAdjustedSignal = applyLifeStateToSignal(signal, planningContext)
      const adjustedSignal = applyPersonaToSignal(lifeAdjustedSignal, persona)
      const decision = routeStimulus(adjustedSignal)
      const candidates = generateBehaviorCandidates(scope, stimulus.id, decision, adjustedSignal)
      const behaviorDecision = selectBehaviorCandidate(stimulus.id, candidates, adjustedSignal)
      const plan = createResponsePlanFromCandidate(behaviorDecision.selected, decision)

      await eventBus.emit('behavior.candidates.generated', {
        stimulusId: stimulus.id,
        scope,
        candidates,
        signal: adjustedSignal,
      })

      logger.info('behavior planned', {
        plugin: 'elysia-ai-behavior',
        phase: 'planning',
        stimulusId: stimulus.id,
        lifeId,
        scope: scope.type,
        decision,
        selectedCandidate: behaviorDecision.selected.type,
        candidateCount: candidates.length,
        shouldEnterDialogue: plan.shouldEnterDialogue,
        perceptionIntent: perception?.intent.primary,
        cognitionSalience: cognition?.salience,
        homeostasisThreshold: homeostasis?.responseThreshold,
        personaName: persona?.name,
        personaTraits: persona?.traits,
      })

      const payload: BehaviorPlannedEventPayload = {
        stimulusId: stimulus.id,
        lifeId,
        scope,
        decision: plan.mode,
        plan,
        signal: adjustedSignal,
        candidates,
        behaviorDecision,
      }

      await eventBus.emit('behavior.selected', payload)

      // 鎻愬彇 stimulus 鏂囨湰鍐呭锛屼紶閫掔粰 dialogue 灞備綔涓?currentUserContent
      const userContent = typeof stimulus.payload?.content === 'string'
        ? stimulus.payload.content
        : undefined

      const executionPlan = createBehaviorExecutionPlan({
        stimulus,
        lifeId,
        plan,
        behaviorDecision,
        selectedCandidate: behaviorDecision.selected,
        currentUserContent: userContent,
        metadata: {
          source: 'elysia-ai-behavior',
          projectionReason: routing.reason,
        },
      })

      await eventBus.emit('behavior.execution.plan.created', {
        planId: executionPlan.id,
        plan: executionPlan,
      })

      if (runtime.behaviorExecution) {
        await runtime.behaviorExecution.execute(executionPlan)
      }

      const instruction = buildInstruction(
        lifeId,
        stimulus.id,
        plan,
        userContent,
      )

      logger.debug('emitting behavior.instruction', {
        plugin: 'elysia-ai-behavior',
        phase: 'planning',
        stimulusId: instruction.stimulusId,
        lifeId: instruction.lifeId,
        actionCount: instruction.actions.length,
        actionTypes: instruction.actions.map((a) => a.type),
      })

      await eventBus.emit('behavior.instruction', { instruction })
    }
  })

  const dispose = () => {
    disposeStimulus()
    disposePerception()
    disposeCognition()
    disposeHomeostasis()
    disposeProjection()
    stimulusCache.clear()
    perceptionCache.clear()
    cognitionCache.clear()
    homeostasisCache.clear()
  }

  return {
    service,
    dispose() {
      dispose()
      logger.info('behavior plugin disposed', {
        plugin: 'elysia-ai-behavior',
        phase: 'dispose',
      })
    },
  }
}
