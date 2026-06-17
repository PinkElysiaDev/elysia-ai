/**
 * Scheduler 核心类型
 *
 * Scheduler 是数字生命的“未来行为调度层”：
 * - 延迟回应
 * - 后续关心
 * - 周期性生命状态 tick
 * - 记忆整理
 * - 失败重试
 * - 主动行为
 *
 * 当前阶段只定义最小可执行契约，不引入 cron、分布式锁、复杂 UI 等生产级能力。
 */

export type ScheduledTaskType =
  | 'followup'
  | 'delayed-response'
  | 'homeostasis-tick'
  | 'memory-consolidation'
  | 'retry'
  | 'proactive-behavior'

export type ScheduledTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export interface ScheduledTaskTarget {
  lifeId?: string
  habitatId?: string
  channelId?: string
  threadId?: string
  actorId?: string
  platform?: string
  botId?: string
}

export interface ScheduledTaskRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs?: number
  backoff?: 'fixed' | 'exponential'
}

export interface ScheduledTaskLease {
  lockedAt?: number
  lockedBy?: string
  lockExpiresAt?: number
}

export interface ScheduledTask {
  id: string
  type: ScheduledTaskType
  status: ScheduledTaskStatus

  target: ScheduledTaskTarget

  runAt: number
  createdAt: number
  updatedAt: number

  priority: number

  payload: Record<string, unknown>
  metadata?: Record<string, unknown>

  attempts: number
  maxAttempts: number
  lastError?: string
  retryPolicy?: ScheduledTaskRetryPolicy

  expiresAt?: number
  lease?: ScheduledTaskLease
}

export interface NewScheduledTask {
  id?: string
  type: ScheduledTaskType
  target?: ScheduledTaskTarget
  runAt: number
  priority?: number
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  maxAttempts?: number
  retryPolicy?: ScheduledTaskRetryPolicy
  expiresAt?: number
}

export interface ScheduledTaskExecutionResult {
  taskId: string
  completed: boolean
  error?: unknown
  retryScheduled?: boolean
  nextRunAt?: number
}

export interface SchedulerLoopOptions {
  enabled: boolean
  tickIntervalMs: number
  batchSize: number
}
