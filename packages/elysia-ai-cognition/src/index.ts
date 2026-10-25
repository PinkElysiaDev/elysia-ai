import { Schema } from 'koishi'
import { createCognitionPluginRuntime } from '@elysia-ai/cognition'
import type { Config as CognitionConfig } from '@elysia-ai/cognition'
import type { CognitionService, CoreEventMap, EventBus } from '@elysia-ai/core'
import { createElysiaPlugin } from '@elysia-ai/shared'
export * from '@elysia-ai/cognition'

export const name = 'elysia-ai-cognition'

// 声明对 runtime 的必需依赖：cordis 会在 elysia.runtime 就绪后再跑本插件 apply。
export const inject = ['elysia.runtime']

export const Config: Schema<CognitionConfig> = Schema.object({
  events: Schema.object({
    enabled: Schema.boolean().default(true)
      .description('事件接收总开关（关闭后不记录任何事件，触发器也随之失效）。'),
    enabledEvents: Schema.dict(Schema.boolean()).description(
      '各事件类型的接收开关（未列出的类型按目录默认值）。message=群消息、mention=被@、reply=引用、direct-message=私聊、member-added/removed=成员变动、reaction=表情回应、bot-sent=自己的发言。',
    ),
    feed: Schema.object({
      include: Schema.dict(Schema.boolean()).description(
        '各事件类型是否呈现在事件清单中（模型可见）。接收≠呈现：例如可记录退群事件用于密度统计但不呈现。',
      ),
      maxEvents: Schema.number().default(30)
        .description('事件清单最多呈现的事件行数。'),
    }).description('事件清单（events 变量）'),
    history: Schema.object({
      maxEvents: Schema.number().default(100)
        .description('每会话事件历史的条数上限。'),
      windowMs: Schema.number().default(1800000)
        .description('事件历史的时间窗（毫秒，默认 30 分钟）。'),
    }).description('事件历史'),
  }).description('事件注入配置'),
}) as Schema<CognitionConfig>

export const apply = createElysiaPlugin<
  CognitionConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
  },
  CognitionService
>({
  name: 'elysia-ai-cognition',
  serviceFormalName: 'elysia.cognition',
  // kernel 兼容治理：声明身份/服务/挂载阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-cognition',
    version: '0.2.0',
    services: { provides: ['elysia.cognition'], consumes: ['elysia.runtime'] },
    stages: { hooks: ['cognition'] },
    configNamespace: 'cognition',
  },
  build({ runtime, config, logger }) {
    return createCognitionPluginRuntime({
      runtime: {
        context: runtime.context,
      },
      config,
      logger,
    })
  },
})
