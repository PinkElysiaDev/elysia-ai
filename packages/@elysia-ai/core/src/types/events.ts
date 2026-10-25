/**
 * 触发器事件（TriggerEvent）：Stimulus 在触发器域内的归一化投影。
 *
 * Stimulus 仍是入站唯一抽象（body 层构造）；TriggerEvent 由
 * @elysia-ai/trigger 的 stimulusToTriggerEvent() 从 Stimulus 派生，
 * 供事件历史 / 密度合并器 / 事件清单（events 变量）消费。
 * 权威类型定义在 core（服务契约引用），trigger 库 re-export。
 */

export interface TriggerEvent {
  /** 事件目录 key（message / mention / reply / direct-message / member-added / …） */
  key: string
  timestamp: number
  /** 来源刺激 id（合成事件可为空） */
  stimulusId?: string
  habitatId: string
  actorId?: string
  /** 发起者展示名（feed 行渲染用；缺省回退 actorId） */
  actorName?: string
  /** 事件负载：content / quoteContent / eventKind / count 等 */
  payload: Record<string, unknown>
}

/** 事件清单构建选项 */
export interface EventFeedOptions {
  maxEvents?: number
}

/** 触发唤醒来源 */
export type TriggerWakeSource = 'batcher' | 'instant' | 'scheduled' | 'manual'
