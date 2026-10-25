import { Schema } from 'koishi'
import { createPerceptionPluginRuntime } from '@elysia-ai/perception'
import type { Config as PerceptionConfig } from '@elysia-ai/perception'
import type { BrainService, CoreEventMap, EventBus } from '@elysia-ai/core'
import { createElysiaPlugin, getOptionalElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/perception'

export const name = 'elysia-ai-perception'

// 声明对 runtime 的必需依赖：cordis 会在 elysia.runtime 就绪后再跑本插件 apply。
export const inject = ['elysia.runtime']

// 触发器重构后逐条 AI 感知与批量 LLM 唤醒冗余：感知回归纯规则版富化
// （意图标签 + 实体 + 情感 + tokenCount，供事件清单行使用），
// 语义判断统一由唤醒时的 LLM（沉默权 + 事件清单）承担。
export const Config: Schema<PerceptionConfig> = Schema.object({
  enabledIntentClassify: Schema.boolean().default(true)
    .description('启用意图识别（判断对方想做什么）。'),
  enabledEntityExtract: Schema.boolean().default(true)
    .description('启用实体抽取（从消息中提取关键信息）。'),
  enabledSentiment: Schema.boolean().default(true)
    .description('启用情感分析（判断对方情绪倾向）。'),
})

export const apply = createElysiaPlugin<
  PerceptionConfig,
  { context: { eventBus: EventBus<CoreEventMap> } },
  ReturnType<typeof createPerceptionPluginRuntime>['service']
>({
  name: 'elysia-ai-perception',
  serviceFormalName: 'elysia.perception',
  runtimeDescription: 'runtime event bus',
  // kernel 兼容治理：声明身份/服务/挂载阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-perception',
    version: '0.2.0',
    services: { provides: ['elysia.perception'], consumes: ['elysia.runtime'] },
    stages: { hooks: ['perception'] },
    configNamespace: 'perception',
  },
  build({ ctx, runtime, config, logger }) {
    const brain = getOptionalElysiaService<BrainService>(ctx, {
      formalName: 'elysia.brain',
    })
    return createPerceptionPluginRuntime({ runtime, brain, config, logger })
  },
})
