import { Schema } from 'koishi'
import { createPerceptionPluginRuntime } from '@elysia-ai/perception'
import type { Config as PerceptionConfig } from '@elysia-ai/perception'
import type { BrainService, CoreEventMap, EventBus } from '@elysia-ai/core'
import { createElysiaPlugin, getOptionalElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/perception'

export const name = 'elysia-ai-perception'

export const Config: Schema<PerceptionConfig> = Schema.intersect([
  Schema.object({
    enabledIntentClassify: Schema.boolean().default(true)
      .description('启用意图识别（判断对方想做什么）。'),
    enabledEntityExtract: Schema.boolean().default(true)
      .description('启用实体抽取（从消息中提取关键信息）。'),
    enabledSentiment: Schema.boolean().default(true)
      .description('启用情感分析（判断对方情绪倾向）。'),
    aiEnhanced: Schema.boolean().default(false)
      .description('启用 AI 增强感知（需在 model-gateway 配置模型槽位）。'),
  }).description('基础设置'),
  Schema.object({
    maxInputTokens: Schema.number().default(8192)
      .description('单次感知分析的最大输入 token 数。'),
    aiFallbackToRuleBased: Schema.boolean().default(true)
      .description('AI 感知失败时回退到规则分析。'),
    aiMinTextLength: Schema.number().default(12)
      .description('触发 AI 增强的最短文本长度。'),
    aiModelSlot: Schema.string().default('')
      .description('AI 感知分析使用的模型槽位名（在 model-gateway 中配置），留空则使用默认槽位。'),
  }).description('高级：AI 增强'),
])

export const apply = createElysiaPlugin<
  PerceptionConfig,
  { context: { eventBus: EventBus<CoreEventMap> } },
  ReturnType<typeof createPerceptionPluginRuntime>['service']
>({
  name: 'elysia-ai-perception',
  serviceFormalName: 'elysia.perception',
  serviceLegacyName: 'elysia-ai-perception',
  runtimeDescription: 'runtime event bus',
  build({ ctx, runtime, config, logger }) {
    const brain = getOptionalElysiaService<BrainService>(ctx, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
    })
    return createPerceptionPluginRuntime({ runtime, brain, config, logger })
  },
})
