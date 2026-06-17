import type { BrainRequest, BrainResponse } from '../brain/brain.js'
import type {
  ModelGatewayRequest,
  ModelGatewayResponse,
} from '../brain/model-gateway.js'
import type {
  BehaviorCandidate,
  BehaviorDecision,
  BehaviorExecutionInstruction,
  BehaviorScope,
  BehaviorSignal,
} from '../types/behavior.js'
import type {
  BehaviorExecutionAction,
  BehaviorExecutionActionResult,
  BehaviorExecutionPlan,
  BehaviorExecutionResult,
} from '../types/behavior-execution.js'
import type {
  Bond,
  BondContextPack,
  BondContextRequest,
  BondQuery,
  BondRelevanceSelectionRequest,
  BondRelevanceSelectionResult,
  BondSearchResult,
  BondUpdateRequest,
  BondUpdateResult,
} from '../types/bond.js'
import type { CognitionResult } from '../types/cognition.js'
import type { DialogueResult, DialogueTask } from '../types/dialogue.js'
import type {
  HomeostasisDelta,
  HomeostasisState,
  HomeostasisUpdateRequest,
  HomeostasisUpdateResult,
} from '../types/homeostasis.js'
import type {
  MemoryConsolidationRequest,
  MemoryConsolidationResult,
  MemoryContextPack,
  MemoryContextRequest,
  MemoryEntry,
  MemoryRelevanceSelectionRequest,
  MemoryRelevanceSelectionResult,
  MemorySearchResult,
  MemoryUpdateRequest,
  MemoryUpdateResult,
} from '../types/memory.js'
import type { PerceptionResult } from '../types/perception.js'
import type { ProjectionRoutingResult, ProjectionRule } from '../types/projection.js'
import type { ScheduledTask } from '../types/scheduler.js'
import type { Stimulus } from '../types/stimulus.js'

export interface SenderTask {
  target: {
    platform?: string
    botId?: string
    guildId?: string
    channelId?: string
    userId?: string
    habitatId?: string
    sourceStimulusId?: string
  }
  content: string
  metadata?: Record<string, unknown>
}

export interface CoreEventMap {
  // Runtime 生命周期事件
  'runtime.starting': { timestamp: number }
  'runtime.started': { timestamp: number }
  'runtime.stopping': { timestamp: number }
  'runtime.stopped': { timestamp: number }

  // Life 实例事件
  'life.loaded': {
    /** 生命体 id */
    lifeId: string
    /** 生命体类型 */
    type: string
    /** 完整的原始配置（供其他插件读取 extensions） */
    config: unknown
  }

  // Stimulus / 状态事件
  'stimulus.received': { stimulusId: string; stimulus: Stimulus }
  'projection.routed': { stimulusId: string; routing: ProjectionRoutingResult }
  'projection.rule.updated': { ruleId: string; rule: ProjectionRule }
  'projection.rule.disabled': { ruleId: string; rule: ProjectionRule }
  'projection.rule.removed': { ruleId: string }
  'perception.completed': { stimulusId: string; result: PerceptionResult }
  'homeostasis.updated': {
    lifeInstanceId: string
    state: HomeostasisState
    delta: HomeostasisDelta
    requestId?: string
    result?: HomeostasisUpdateResult
    planId?: string
    actionId?: string
  }
  'homeostasis.update.failed': {
    requestId: string
    request: HomeostasisUpdateRequest
    error: unknown
    planId?: string
    actionId?: string
  }

  // Scheduler 事件
  'scheduler.task.created': { taskId: string; task: ScheduledTask }
  'scheduler.task.started': { taskId: string; task: ScheduledTask }
  'scheduler.task.completed': { taskId: string; task: ScheduledTask }
  'scheduler.task.failed': { taskId: string; task: ScheduledTask; error: unknown }
  'scheduler.task.cancelled': { taskId: string; task: ScheduledTask; reason?: string }
  'scheduler.task.expired': { taskId: string; task: ScheduledTask }

  // Cognition 事件
  'cognition.reasoning': {
    stimulusId: string
    lifeId?: string
    scopeKey?: string
  }
  'cognition.completed': CognitionResult

  // Behavior 事件
  'behavior.candidates.generated': {
    stimulusId: string
    scope: BehaviorScope
    candidates: BehaviorCandidate[]
    signal: BehaviorSignal
  }
  'behavior.selected': {
    stimulusId: string
    lifeId?: string
    scope: BehaviorScope
    decision:
      | 'discard'
      | 'buffer'
      | 'internal-update-only'
      | 'program-direct'
      | 'send-to-ai'
    plan: {
      scope: BehaviorScope
      sourceStimulusIds: string[]
      mode:
        | 'discard'
        | 'buffer'
        | 'internal-update-only'
        | 'program-direct'
        | 'send-to-ai'
      plannerSource: 'program' | 'ai' | 'hybrid'
      shouldEnterDialogue: boolean
      shouldUpdateMemory: boolean
      shouldUpdateBond: boolean
      shouldUpdateHomeostasis: boolean
      shouldScheduleFollowup: boolean
      reason: string
    }
    signal: BehaviorSignal
    candidates?: BehaviorCandidate[]
    behaviorDecision?: BehaviorDecision
  }

  /**
   * behavior 层向 runtime 调度器发出的执行指令
   *
   * 替代 behavior.selected 的直接消费模式，behavior 负责规划后
   * 发出该指令，由 runtime 调度器按 lifeId 路由并分发到各执行器。
   */
  'behavior.instruction': {
    instruction: BehaviorExecutionInstruction
  }
  'behavior.execution.plan.created': {
    planId: string
    plan: BehaviorExecutionPlan
  }
  'behavior.execution.started': {
    planId: string
    plan: BehaviorExecutionPlan
  }
  'behavior.execution.action.started': {
    planId: string
    actionId: string
    action: BehaviorExecutionAction
  }
  'behavior.execution.action.completed': {
    planId: string
    actionId: string
    action: BehaviorExecutionAction
    result: BehaviorExecutionActionResult
  }
  'behavior.execution.action.failed': {
    planId: string
    actionId: string
    action: BehaviorExecutionAction
    error: unknown
  }
  'behavior.execution.completed': {
    planId: string
    plan: BehaviorExecutionPlan
    result: BehaviorExecutionResult
  }
  'behavior.execution.failed': {
    planId: string
    plan: BehaviorExecutionPlan
    error: unknown
  }
  'behavior.followup.scheduled': {
    stimulusId: string
    lifeId?: string
    candidateId?: string
    taskId: string
    task: ScheduledTask
    planId?: string
    actionId?: string
  }
  'behavior.memory.update.requested': {
    request: MemoryUpdateRequest
    planId?: string
    actionId?: string
  }
  'behavior.bond.update.requested': {
    request: BondUpdateRequest
    planId?: string
    actionId?: string
  }
  'behavior.homeostasis.update.requested': {
    request: HomeostasisUpdateRequest
    planId?: string
    actionId?: string
  }

  // Memory 事件
  'memory.created': {
    requestId: string
    entry: MemoryEntry
    result: MemoryUpdateResult
    planId?: string
    actionId?: string
  }
  'memory.updated': {
    requestId: string
    entry: MemoryEntry
    result: MemoryUpdateResult
    planId?: string
    actionId?: string
  }
  'memory.update.failed': {
    requestId: string
    request: MemoryUpdateRequest
    error: unknown
    planId?: string
    actionId?: string
  }
  'memory.retrieved': {
    query: import('../types/memory.js').MemoryQuery
    result: MemorySearchResult
  }
  'memory.retrieve.failed': {
    query: import('../types/memory.js').MemoryQuery
    error: unknown
  }
  'memory.context.requested': {
    request: MemoryContextRequest
  }
  'memory.context.selected': {
    request: MemoryContextRequest
    context: MemoryContextPack
  }
  'memory.context.failed': {
    request: MemoryContextRequest
    error: unknown
  }
  'memory.relevance.selection.requested': {
    request: MemoryRelevanceSelectionRequest
  }
  'memory.relevance.selection.completed': {
    request: MemoryRelevanceSelectionRequest
    result: MemoryRelevanceSelectionResult
  }
  'memory.relevance.selection.failed': {
    request: MemoryRelevanceSelectionRequest
    error: unknown
    fallbackResult?: MemoryRelevanceSelectionResult
  }
  'memory.relevance.selection.fallback': {
    request: MemoryRelevanceSelectionRequest
    result: MemoryRelevanceSelectionResult
    reason: string
  }
  'memory.consolidation.requested': {
    request: MemoryConsolidationRequest
  }
  'memory.consolidated': {
    requestId: string
    result: MemoryConsolidationResult
  }
  'memory.consolidation.failed': {
    requestId: string
    request: MemoryConsolidationRequest
    error: unknown
  }

  // Bond 事件
  'bond.created': {
    requestId: string
    bond: Bond
    result: BondUpdateResult
    planId?: string
    actionId?: string
  }
  'bond.updated': {
    requestId: string
    bond: Bond
    result: BondUpdateResult
    planId?: string
    actionId?: string
  }
  'bond.update.failed': {
    requestId: string
    request: BondUpdateRequest
    error: unknown
    planId?: string
    actionId?: string
  }
  'bond.retrieved': {
    query: BondQuery
    result: BondSearchResult
  }
  'bond.retrieve.failed': {
    query: BondQuery
    error: unknown
  }
  'bond.context.requested': {
    request: BondContextRequest
  }
  'bond.context.selected': {
    request: BondContextRequest
    context: BondContextPack
  }
  'bond.context.failed': {
    request: BondContextRequest
    error: unknown
  }
  'bond.relevance.selection.requested': {
    request: BondRelevanceSelectionRequest
  }
  'bond.relevance.selection.completed': {
    request: BondRelevanceSelectionRequest
    result: BondRelevanceSelectionResult
  }
  'bond.relevance.selection.failed': {
    request: BondRelevanceSelectionRequest
    error: unknown
    fallbackResult?: BondRelevanceSelectionResult
  }
  'bond.relevance.selection.fallback': {
    request: BondRelevanceSelectionRequest
    result: BondRelevanceSelectionResult
    reason: string
  }

  // Dialogue 事件
  'dialogue.task.created': { task: DialogueTask }
  'dialogue.generation.requested': { task: DialogueTask }
  'dialogue.started': { task: DialogueTask }
  'dialogue.generated': { task: DialogueTask; result: DialogueResult }
  'dialogue.output.created': {
    outputId: string
    stimulusId: string
    habitatId?: string
    threadId?: string
    actorId?: string
    content: string
    task: DialogueTask
    result: DialogueResult
    messages?: import('../types/dialogue.js').DialogueMessage[]
    metadata?: Record<string, unknown>
  }
  'dialogue.completed': { task: DialogueTask; result: DialogueResult }
  'dialogue.failed': { task: DialogueTask; error: unknown }

  // Brain 事件
  'brain.requested': { request: BrainRequest }
  'brain.completed': { request: BrainRequest; response: BrainResponse }
  'brain.failed': { request: BrainRequest; error: unknown }

  // Gateway 事件
  'gateway.requested': { request: ModelGatewayRequest }
  'gateway.responded': {
    request: ModelGatewayRequest
    response: ModelGatewayResponse
    diagnostics?: Record<string, unknown>
    healthSnapshots?: Array<Record<string, unknown>>
  }
  'gateway.failed': {
    request: ModelGatewayRequest
    error: unknown
    diagnostics?: Record<string, unknown>
    healthSnapshots?: Array<Record<string, unknown>>
  }


  // Repository diagnostics events
  'repository.initialized': {
    component: string
    repositoryType: string
    collectionName?: string
    metadata?: Record<string, unknown>
  }
  'repository.query.failed': {
    component: string
    repositoryType: string
    operation: string
    error: unknown
    metadata?: Record<string, unknown>
  }
  'repository.write.failed': {
    component: string
    repositoryType: string
    operation: string
    error: unknown
    metadata?: Record<string, unknown>
  }
  'repository.fallback-to-memory': {
    component: string
    repositoryType: string
    reason: string
    metadata?: Record<string, unknown>
  }

  // Sender / Body 事件
  'sender.started': { task: SenderTask }
  'sender.completed': { task: SenderTask }
  'sender.failed': { task: SenderTask; error: unknown }
  'body.message.sent': { task: SenderTask }
  'body.message.failed': { task: SenderTask; error: unknown }
}
