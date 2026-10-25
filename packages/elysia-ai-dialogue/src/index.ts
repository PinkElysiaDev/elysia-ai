import { Schema } from 'koishi'
import { createDialoguePluginRuntime } from '@elysia-ai/dialogue'
import type { Config as DialogueConfig } from '@elysia-ai/dialogue'
import type { BondContextProvider, BrainService, ConversationStore, CoreEventMap, DialogueService, EventBus, MemoryContextProvider, PipelineRunner } from '@elysia-ai/core'
import { createElysiaPlugin, getOptionalElysiaService, getRequiredElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/dialogue'

export const name = 'elysia-ai-dialogue'

// 声明对 runtime + brain 的必需依赖：cordis 会在两者就绪后再跑本插件 apply。
// memory/bond 是可选依赖，不放这里，由 build() 内 getOptionalElysiaService 走降级。
export const inject = ['elysia.runtime', 'elysia.brain']

export const Config: Schema<DialogueConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用对话编排能力。'),
  memoryLimit: Schema.number().default(10).description('用于上下文的最大对话历史条数。'),
})

export const apply = createElysiaPlugin<
  DialogueConfig,
  {
    context: { eventBus: EventBus<CoreEventMap>, pipeline: PipelineRunner<unknown> }
    conversationStore?: ConversationStore
  },
  DialogueService
>({
  name: 'elysia-ai-dialogue',
  serviceFormalName: 'elysia.dialogue',
  // kernel 兼容治理：声明身份/服务/挂载阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-dialogue',
    version: '0.2.0',
    services: { provides: ['elysia.dialogue'], consumes: ['elysia.runtime'] },
    stages: { hooks: ['dialogue'] },
    configNamespace: 'dialogue',
  },
  runtimeDescription: 'runtime event bus',
  build({ ctx, runtime, config, logger }) {
    const brain = getRequiredElysiaService<BrainService>(ctx, {
      formalName: 'elysia.brain',
      logger,
      plugin: 'elysia-ai-dialogue',
      description: 'brain service',
    })
    if (!brain) return undefined
    const memory = getOptionalElysiaService<{ contextProvider?: MemoryContextProvider }>(ctx, {
      formalName: 'elysia.memory',
    })
    const bond = getOptionalElysiaService<{ contextProvider?: BondContextProvider }>(ctx, {
      formalName: 'elysia.bond',
    })
    return createDialoguePluginRuntime({ runtime, brain, memory, bond, config, logger })
  },
})
