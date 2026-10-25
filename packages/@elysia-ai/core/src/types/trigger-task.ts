/**
 * 定时触发器任务模型（chatluna TriggerTask 精简版）。
 * 权威类型在 core（仓储契约引用），@elysia-ai/trigger re-export。
 *
 * condition v1：once / interval（锚点模运算防漂移）/ cron。
 * calendar / window / inactivity 列为后续迭代。
 * state 与任务同文档存储；occurrenceKey 是防重复触发的幂等键。
 */

export type TriggerMisfirePolicy = 'skip' | 'fire_once'

export type TriggerCondition =
  | { type: 'once'; at: string }
  | { type: 'interval'; everyMinutes: number; anchorAt?: string; misfire?: TriggerMisfirePolicy }
  | {
    /** 数组表达式（任一匹配即构成 occurrence，取最近下次时刻）——
     * 平替 chatluna calendar/window："工作日 9:00 与 18:30" = ["0 9 * * 1-5","30 18 * * 1-5"] */
    type: 'cron'; expression: string | string[]; timezone?: string; misfire?: TriggerMisfirePolicy
  }

export type TriggerTaskStatus = 'waiting' | 'running' | 'paused' | 'completed' | 'error'

export interface TriggerTaskState {
  status: TriggerTaskStatus
  /** 下次应运行时刻（ms）；null = 无排程（completed/error/paused 无限期） */
  nextRunAt: number | null
  /** occurrence 幂等键（同一 occurrence 只跑一次） */
  occurrenceKey: string | null
  lastRunAt: number | null
  runCount: number
  lastError: string | null
  /** paused 的唤醒时刻（pause_until） */
  pausedUntil: number | null
}

export interface TriggerTask {
  id: string
  name: string
  enabled: boolean
  /** 目标生命（缺省 = 部署内单 life） */
  lifeId?: string
  /** 触发目标 habitat（锁定创建时会话；'*' = 广播到该 life 的全部活跃窗口） */
  habitatId: string
  /** 创建会话的路由快照（platform/botId/channelId）：重启后 habitatRouting
   *  内存缓存清空，定时唤醒的发送目标由此恢复（广播任务不适用，展开时实时解析） */
  routing?: {
    platform?: string
    botId?: string
    guildId?: string
    channelId?: string
  }
  condition: TriggerCondition
  /** 触发时的任务指令（唤醒提示首段） */
  prompt: string
  /** 创建者 platform:botId:userId（权限归属） */
  ownerKey: string
  createdAt: number
  updatedAt: number
  state: TriggerTaskState
}

export function createInitialTriggerState(now: number): TriggerTaskState {
  return {
    status: 'waiting',
    nextRunAt: null,
    occurrenceKey: null,
    lastRunAt: null,
    runCount: 0,
    lastError: null,
    pausedUntil: null,
  }
}

/** 校验并归一条件（LLM/用户输入的第一道防线；具体时区/表达式合法性在 planner 试解析）。 */
export function normalizeTriggerCondition(condition: TriggerCondition): TriggerCondition | { error: string } {
  switch (condition.type) {
    case 'once': {
      const at = Date.parse(condition.at)
      if (Number.isNaN(at)) return { error: 'once.at must be an ISO timestamp' }
      return { type: 'once', at: condition.at }
    }
    case 'interval': {
      if (!Number.isFinite(condition.everyMinutes) || condition.everyMinutes <= 0) {
        return { error: 'interval.everyMinutes must be a positive number' }
      }
      if (condition.everyMinutes < 1) return { error: 'interval.everyMinutes must be >= 1 minute' }
      return {
        type: 'interval',
        everyMinutes: Math.floor(condition.everyMinutes),
        ...(condition.anchorAt ? { anchorAt: condition.anchorAt } : {}),
        misfire: condition.misfire ?? 'skip',
      }
    }
    case 'cron': {
      const raw = condition.expression
      const list = Array.isArray(raw) ? raw : [raw]
      const expressions = list
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim())
      if (list.length === 0 || expressions.length !== list.length) {
        return { error: 'cron.expression must be a non-empty string or string array' }
      }
      // 归一为数组存储（planner 单形态处理；去重保持稳定序）
      const unique = [...new Set(expressions)]
      return {
        type: 'cron',
        expression: unique.length === 1 ? unique[0] : unique,
        ...(condition.timezone ? { timezone: condition.timezone } : {}),
        misfire: condition.misfire ?? 'skip',
      }
    }
    default:
      return { error: 'condition.type must be one of: once / interval / cron' }
  }
}
