/**
 * 定时触发器时间数学（chatluna planner 精简版，纯函数）。
 *
 * interval 用锚点模运算从锚点推算而非在上次运行时间上累加——
 * 运行延迟/跳过不会造成相位漂移（chatluna planner.ts:403-412 同款）。
 * cron 委托 cron-parser。occurrenceKey 是防重复触发的幂等键。
 */

import { parseExpression } from 'cron-parser'
import type { TriggerCondition, TriggerTask, TriggerTaskState } from './trigger-task.js'

export interface TriggerOccurrence {
  at: number
  occurrenceKey: string
}

/** 计算 after 之后的下一个 occurrence；无（once 已过期 / 表达式无解）返回 null。 */
export function computeNextOccurrence(
  condition: TriggerCondition,
  after: number,
  context: { taskAnchor: number; taskId: string },
): TriggerOccurrence | null {
  switch (condition.type) {
    case 'once': {
      const at = Date.parse(condition.at)
      if (Number.isNaN(at)) return null
      if (at <= after) return null
      return { at, occurrenceKey: `${context.taskId}:once` }
    }
    case 'interval': {
      const everyMs = condition.everyMinutes * 60_000
      const anchor = condition.anchorAt !== undefined ? Date.parse(condition.anchorAt) : context.taskAnchor
      if (Number.isNaN(anchor) || everyMs <= 0) return null
      const index = Math.max(0, Math.floor((after - anchor) / everyMs) + 1)
      const at = anchor + index * everyMs
      return { at, occurrenceKey: `${context.taskId}:interval:${at}` }
    }
    case 'cron': {
      // 数组表达式：任一匹配即构成 occurrence，取全部表达式中最近的下次时刻。
      // cron-parser 原生 IANA 时区（DST 由库托管，无需 chatluna calendar 的手工防护）。
      const expressions = Array.isArray(condition.expression) ? condition.expression : [condition.expression]
      let best: { at: number; index: number } | undefined
      for (let index = 0; index < expressions.length; index++) {
        try {
          const interval = parseExpression(expressions[index], {
            currentDate: new Date(after),
            ...(condition.timezone ? { tz: condition.timezone } : {}),
          })
          const at = interval.next().getTime()
          if (best === undefined || at < best.at) best = { at, index }
        } catch {
          // 单条非法：跳过（其余仍可构成 occurrence；全部非法 → 无解）
        }
      }
      if (best === undefined) return null
      return { at: best.at, occurrenceKey: `${context.taskId}:cron:${best.index}:${best.at}` }
    }
    default:
      return null
  }
}

/** 条件可解析性预检（create/update 时的即时反馈）。 */
export function validateTriggerCondition(condition: TriggerCondition): string | null {
  switch (condition.type) {
    case 'once':
      return Number.isNaN(Date.parse(condition.at)) ? 'once.at is not a valid ISO timestamp' : null
    case 'interval':
      return condition.everyMinutes > 0 ? null : 'interval.everyMinutes must be positive'
    case 'cron': {
      const expressions = Array.isArray(condition.expression) ? condition.expression : [condition.expression]
      if (expressions.length === 0) return 'cron.expression must not be empty'
      for (const expression of expressions) {
        try {
          parseExpression(expression, condition.timezone ? { tz: condition.timezone } : undefined)
        } catch (error) {
          return `invalid cron expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
        }
      }
      return null
    }
    default:
      return 'unknown condition type'
  }
}

/** 建任务/启用时的初始状态。 */
export function initialTriggerState(task: TriggerTask, now: number): TriggerTaskState {
  if (!task.enabled) {
    return { status: 'paused', nextRunAt: null, occurrenceKey: null, lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null }
  }
  const occurrence = computeNextOccurrence(task.condition, now, { taskAnchor: task.createdAt, taskId: task.id })
  if (!occurrence) {
    // once 已过期：视作 completed（misfire=fire_once 的补跑语义由调用方在 create 前处理）
    return { status: 'completed', nextRunAt: null, occurrenceKey: null, lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null }
  }
  return { status: 'waiting', nextRunAt: occurrence.at, occurrenceKey: occurrence.occurrenceKey, lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null }
}

/**
 * 一次运行结束后的下一状态：
 * - once → completed；
 * - interval/cron → 推算下个 occurrence（无解 → completed）；
 * - 保留 lastRunAt/runCount 历史字段。
 */
export function afterTriggerRun(task: TriggerTask, now: number): TriggerTaskState {
  const base = task.state
  if (task.condition.type === 'once') {
    return { ...base, status: 'completed', nextRunAt: null, occurrenceKey: null, lastRunAt: now, runCount: base.runCount + 1 }
  }
  const occurrence = computeNextOccurrence(task.condition, now, { taskAnchor: task.createdAt, taskId: task.id })
  if (!occurrence) {
    return { ...base, status: 'completed', nextRunAt: null, occurrenceKey: null, lastRunAt: now, runCount: base.runCount + 1 }
  }
  return {
    ...base,
    status: 'waiting',
    nextRunAt: occurrence.at,
    occurrenceKey: occurrence.occurrenceKey,
    lastRunAt: now,
    runCount: base.runCount + 1,
    lastError: null,
  }
}

/** misfire 判定：到期任务在停机期间错过，重启收割时按策略处理。 */
export function resolveMisfire(
  condition: TriggerCondition,
  scheduledAt: number,
  now: number,
): 'fire' | 'skip' {
  if (now - scheduledAt < 60_000) return 'fire'  // 1 分钟内视为正常延迟
  const policy = condition.type === 'once' ? 'fire_once' : (condition.misfire ?? 'skip')
  return policy === 'fire_once' ? 'fire' : 'skip'
}
