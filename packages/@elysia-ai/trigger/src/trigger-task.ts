/**
 * 定时触发器任务类型：权威定义在 @elysia-ai/core（types/trigger-task.ts），
 * 此处提供便捷 re-export（`import { TriggerTask } from '@elysia-ai/trigger'`）。
 */

export type {
  TriggerCondition,
  TriggerMisfirePolicy,
  TriggerTask,
  TriggerTaskState,
  TriggerTaskStatus,
} from '@elysia-ai/core'
export { createInitialTriggerState, normalizeTriggerCondition } from '@elysia-ai/core'
