import { Schema } from 'koishi'
import { createBehaviorPluginRuntime } from '@elysia-ai/behavior'
import type { Config as BehaviorConfig } from '@elysia-ai/behavior'
import type { BehaviorExecutionService, BehaviorService, CoreEventMap, EventBus, Persona } from '@elysia-ai/core'
import { createElysiaPlugin } from '@elysia-ai/shared'
export * from '@elysia-ai/behavior'

export const name = 'elysia-ai-behavior'

export const Config: Schema<BehaviorConfig> = Schema.intersect([
  Schema.object({
    enableReply: Schema.boolean().default(true)
      .description('是否允许主动回复消息。关闭后生命体只观察、更新内部状态，但不出声。'),
  }).description('基础设置'),
  Schema.object({
    directWindowMs: Schema.number().default(1500)
      .description('被直接点名（@/ 私聊）后，多久内的后续消息合并为一次回应（毫秒）。越大越倾向凑齐再回。'),
    userBufferedWindowMs: Schema.number().default(2500)
      .description('同一用户连续发言的攒话窗口（毫秒）。'),
    threadBufferedWindowMs: Schema.number().default(3500)
      .description('同一话题串的攒话窗口（毫秒）。'),
    habitatBufferedWindowMs: Schema.number().default(5000)
      .description('整个群聊场景的攒话窗口（毫秒）。'),
  }).description('高级：行为节奏调参'),
])

export const apply = createElysiaPlugin<
  BehaviorConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
    personaRegistry?: { getByLifeId(lifeId: string): Persona | undefined }
    behaviorExecution?: BehaviorExecutionService
  },
  BehaviorService
>({
  name: 'elysia-ai-behavior',
  serviceFormalName: 'elysia.behavior',
  serviceLegacyName: 'elysia-ai-behavior',
  build({ runtime, config, logger }) {
    return createBehaviorPluginRuntime({ runtime, config, logger })
  },
})
