import { Schema } from 'koishi'
import { createDialoguePluginRuntime } from '@elysia-ai/dialogue'
import type { Config as DialogueConfig } from '@elysia-ai/dialogue'
import type { BondContextProvider, BrainService, ConversationStore, CoreEventMap, DialogueService, EventBus, MemoryContextProvider } from '@elysia-ai/core'
import { createElysiaPlugin, getOptionalElysiaService, getRequiredElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/dialogue'

export const name = 'elysia-ai-dialogue'

export const Config: Schema<DialogueConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用对话编排能力。'),
  memoryLimit: Schema.number().default(10).description('用于上下文的最大对话历史条数。'),
})

export const apply = createElysiaPlugin<
  DialogueConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
    conversationStore?: ConversationStore
    memoryContextProvider?: MemoryContextProvider
    bondContextProvider?: BondContextProvider
  },
  DialogueService
>({
  name: 'elysia-ai-dialogue',
  serviceFormalName: 'elysia.dialogue',
  serviceLegacyName: 'elysia-ai-dialogue',
  runtimeDescription: 'runtime event bus',
  build({ ctx, runtime, config, logger }) {
    const brain = getRequiredElysiaService<BrainService>(ctx, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
      logger,
      plugin: 'elysia-ai-dialogue',
      description: 'brain service',
    })
    if (!brain) return undefined
    const memory = getOptionalElysiaService<{ contextProvider?: MemoryContextProvider }>(ctx, {
      formalName: 'elysia.memory',
      legacyName: 'elysia-ai-memory',
    })
    const bond = getOptionalElysiaService<{ contextProvider?: BondContextProvider }>(ctx, {
      formalName: 'elysia.bond',
      legacyName: 'elysia-ai-bond',
    })
    return createDialoguePluginRuntime({ runtime, brain, memory, bond, config, logger })
  },
})
