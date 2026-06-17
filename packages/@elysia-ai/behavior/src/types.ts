import type {
  BehaviorCandidate,
  BehaviorDecision,
  CognitionResult,
  HomeostasisState,
  PerceptionResult,
  Persona,
  Stimulus,
} from '@elysia-ai/core'

export type StimulusScopeType = 'user' | 'thread' | 'habitat' | 'life-global'

export interface StimulusScope {
  type: StimulusScopeType
  key: string
}

export interface StimulusBucket {
  key: string
  scope: StimulusScope
  stimulusIds: string[]
  createdAt: number
  updatedAt: number
}

export interface StimulusSignal {
  directness: number
  continuity: number
  bondAffinity: number
  bufferPressure: number
  responseNecessity: number
  structuralDeterminability: number
}

export type ProgramRoutingDecision =
  | 'discard'
  | 'buffer'
  | 'internal-update-only'
  | 'program-direct'
  | 'send-to-ai'

export type PlannerSource = 'program' | 'ai' | 'hybrid'

export interface ResponsePlan {
  scope: StimulusScope
  sourceStimulusIds: string[]
  mode: ProgramRoutingDecision
  plannerSource: PlannerSource
  shouldEnterDialogue: boolean
  shouldUpdateMemory: boolean
  shouldUpdateBond: boolean
  shouldUpdateHomeostasis: boolean
  shouldScheduleFollowup: boolean
  reason: string
}

export interface BehaviorPlanningContext {
  directWindowMs: number
  userBufferedWindowMs: number
  threadBufferedWindowMs: number
  habitatBufferedWindowMs: number
  lifeId?: string
  perception?: PerceptionResult
  cognition?: CognitionResult
  homeostasis?: HomeostasisState
  persona?: Persona
  bondAffinity?: number
  now?: number
  threadId?: string
  bucketStimulusCount?: number
}

export interface BehaviorPlannedEventPayload {
  stimulusId: string
  lifeId?: string
  scope: StimulusScope
  decision: ProgramRoutingDecision
  plan: ResponsePlan
  signal: StimulusSignal
  candidates?: BehaviorCandidate[]
  behaviorDecision?: BehaviorDecision
}

export interface BehaviorLogger {
  info(message: string, meta?: Record<string, any>): void
  debug(message: string, meta?: Record<string, any>): void
  error(message: string, error?: unknown, meta?: Record<string, any>): void
}

export interface BehaviorPlannerInput {
  stimulus: Stimulus
  context: BehaviorPlanningContext
}
