/**
 * 触发器事件（TriggerEvent）。
 *
 * 权威类型定义在 @elysia-ai/core（types/events.ts）——服务契约（core 的
 * CognitionService/BehaviorService）需要引用它，而依赖方向是 trigger → core，
 * 因此此处提供便捷 re-export（`import { TriggerEvent } from '@elysia-ai/trigger'`）。
 */

export type { TriggerEvent } from '@elysia-ai/core'
