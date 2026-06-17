export type BehaviorScopeType = 'user' | 'thread' | 'habitat' | 'life-global'

export interface BehaviorScope {
  type: BehaviorScopeType
  key: string
}

export interface BehaviorSignal {
  directness: number
  continuity: number
  bondAffinity: number
  bufferPressure: number
  responseNecessity: number
  structuralDeterminability: number
}

export type BehaviorActionType =
  | 'discard'
  | 'observe'
  | 'reply'
  | 'ask'
  | 'quote'
  | 'defer'
  | 'memory-only'
  | 'state-update'
  | 'proactive-topic'

export type BehaviorPlannerSource = 'program' | 'ai' | 'hybrid'

export interface BehaviorCandidate {
  id: string
  type: BehaviorActionType
  scope: BehaviorScope
  sourceStimulusIds: string[]
  priority: number
  confidence: number
  reason: string
  shouldEnterDialogue: boolean
  shouldUpdateMemory: boolean
  shouldUpdateBond: boolean
  shouldUpdateHomeostasis: boolean
  shouldScheduleFollowup: boolean
  metadata?: Record<string, unknown>
}

export interface BehaviorDecision {
  id: string
  selected: BehaviorCandidate
  candidates: BehaviorCandidate[]
  signal: BehaviorSignal
  plannerSource: BehaviorPlannerSource
  decidedAt: number
  reason: string
  metadata?: Record<string, unknown>
}

/**
 * 行为策略（可序列化的规划结果）
 *
 * 是 BehaviorDecision 的简化版，仅保留执行时必需的信息，
 * 用于从 behavior 层传递规划结果给 runtime 调度器。
 *
 * @see ResponsePlan in @elysia-ai/behavior/src/types.ts
 */
export interface ResponsePlan {
  /** behavior 作用域 */
  scope: BehaviorScope
  /** 触发源 stimulus id 列表 */
  sourceStimulusIds: string[]
  /** 规划模式 */
  mode: 'discard' | 'buffer' | 'internal-update-only' | 'program-direct' | 'send-to-ai'
  /** 规划来源 */
  plannerSource: BehaviorPlannerSource
  /** 是否进入对话生成流程 */
  shouldEnterDialogue: boolean
  /** 是否更新记忆 */
  shouldUpdateMemory: boolean
  /** 是否更新羁绊 */
  shouldUpdateBond: boolean
  /** 是否更新稳态 */
  shouldUpdateHomeostasis: boolean
  /** 是否安排后续动作 */
  shouldScheduleFollowup: boolean
  /** 决策理由 */
  reason: string
}

/**
 * behavior 层执行动作
 *
 * 每种动作对应 runtime 调度器中的一个执行路径。
 * - dialogue: 调用 DialogueService.execute()
 * - defer: 延迟处理（通常写入 buffer 池）
 * - silent: 静默处理（仅内部更新，不输出）
 */
export type BehaviorAction =
  | { type: 'dialogue'; task: import('./dialogue.js').DialogueTask }
  | { type: 'defer'; reason: string; untilMs?: number }
  | { type: 'silent'; reason: string }
  | { type: 'internal-update'; reason: string }

/**
 * behavior 层执行指令
 *
 * 由 behavior 层在完成规划后发出，runtime 调度器接收此指令
 * 并将各 action 分发给对应执行器。
 *
 * 设计原则：
 * - lifeId 供 runtime 按 life 实例路由
 * - stimulusId 用于 trace 追踪
 * - actions 列表允许一条 stimulus 触发多个执行动作
 */
export interface BehaviorExecutionInstruction {
  /** 目标生命体 id */
  lifeId: string
  /** 触发源 stimulus id */
  stimulusId: string
  /** 行为规划结果（供 observatory 记录） */
  plan: ResponsePlan
  /** 需要执行的动作列表 */
  actions: BehaviorAction[]
}
