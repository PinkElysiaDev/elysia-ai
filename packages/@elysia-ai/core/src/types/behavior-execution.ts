import type { BehaviorScope, ResponsePlan } from './behavior.js'
import type { BondUpdateRequest } from './bond.js'
import type { DialogueTask } from './dialogue.js'
import type { HomeostasisUpdateRequest } from './homeostasis.js'
import type { MemoryUpdateRequest } from './memory.js'
import type { Stimulus } from './stimulus.js'

export type BehaviorExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'

export type BehaviorExecutionActionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type BehaviorExecutionActionType =
  | 'dialogue'
  | 'memory-update'
  | 'bond-update'
  | 'homeostasis-update'
  | 'emit-event'
  | 'noop'

export interface BehaviorExecutionRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs?: number
  backoff?: 'fixed' | 'exponential'
}

export interface BehaviorExecutionAction {
  id: string
  type: BehaviorExecutionActionType
  status: BehaviorExecutionActionStatus
  priority: number
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
  retryPolicy?: BehaviorExecutionRetryPolicy
  createdAt: number
  startedAt?: number
  completedAt?: number
  failedAt?: number
  skippedAt?: number
  lastError?: string
  metadata?: Record<string, unknown>
}

export interface BehaviorExecutionPlan {
  id: string
  stimulusId: string
  lifeId?: string
  habitatId?: string
  actorId?: string
  threadId?: string
  channelId?: string
  platform?: string
  botId?: string
  scope: BehaviorScope
  scopeKey?: string
  plan: ResponsePlan
  actions: BehaviorExecutionAction[]
  priority: number
  status: BehaviorExecutionStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  failedAt?: number
  lastError?: string
  metadata?: Record<string, unknown>
}

export interface BehaviorExecutionActionResult {
  planId: string
  actionId: string
  type: BehaviorExecutionActionType
  completed: boolean
  skipped?: boolean
  startedAt: number
  completedAt: number
  error?: unknown
  emittedEvent?: string
  metadata?: Record<string, unknown>
}

export interface BehaviorExecutionResult {
  planId: string
  completed: boolean
  status: BehaviorExecutionStatus
  actionResults: BehaviorExecutionActionResult[]
  startedAt: number
  completedAt: number
  error?: unknown
  metadata?: Record<string, unknown>
}
export interface BehaviorExecutionService {
  execute(plan: BehaviorExecutionPlan): Promise<BehaviorExecutionResult>
}

export interface BehaviorExecutionPlannerInput {
  stimulus: Stimulus
  lifeId: string
  plan: ResponsePlan
  currentUserContent?: string
  now?: number
  actionMaxAttempts?: number
  metadata?: Record<string, unknown>
}

export interface BehaviorExecutionPolicy {
  actionMaxAttempts: number
  failurePolicy: 'continue' | 'stop-on-critical'
}
