import { Schema } from 'koishi'
import { createBrainPluginRuntime } from '@elysia-ai/brain'
import type { Config as BrainConfig } from '@elysia-ai/brain'
import type { BrainService, CoreEventMap, EventBus, ModelGatewayService, PersonaRegistry } from '@elysia-ai/core'
import { createElysiaPlugin, getRequiredElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/brain'

export const name = 'elysia-ai-brain'

export const Config: Schema<BrainConfig> = Schema.intersect([
  Schema.object({
    systemPrompt: Schema.string().description('兜底系统提示词：当生命体没有人格提示时使用。'),
    defaultModelSlot: Schema.string().description('大脑默认使用的 model-gateway 模型槽位。'),
    contextWindow: Schema.number().default(20).description('大脑请求中包含的最大对话历史条数。'),
  }).description('基础设置'),
  Schema.object({
    contextBudget: Schema.object({
      maxMemoryChars: Schema.number().default(4000).description('记忆上下文的最大字符数。'),
      maxBondChars: Schema.number().default(3000).description('羁绊上下文的最大字符数。'),
      maxPersonaChars: Schema.number().default(2000).description('人格上下文的最大字符数。'),
      maxSystemPromptChars: Schema.number().default(12000).description('组合后系统提示词的最大字符数。'),
      maxEstimatedTokens: Schema.number().description('提示词预估 token 上限（留空不限制）。'),
      tokenEstimateRatio: Schema.number().default(4).description('字符到 token 的预估比率。'),
    }).description('上下文预算策略。'),
  }).description('高级：上下文预算'),
])

export const apply = createElysiaPlugin<
  BrainConfig,
  { context: { eventBus: EventBus<CoreEventMap> }, personaRegistry?: PersonaRegistry },
  BrainService
>({
  name: 'elysia-ai-brain',
  serviceFormalName: 'elysia.brain',
  serviceLegacyName: 'elysia-ai-brain',
  runtimeDescription: 'runtime event bus',
  build({ ctx, runtime, config, logger }) {
    const modelGateway = getRequiredElysiaService<ModelGatewayService>(ctx, {
      formalName: 'elysia.modelGateway',
      legacyName: 'elysia-ai-model-gateway',
      logger,
      plugin: 'elysia-ai-brain',
      description: 'model gateway service',
    })
    if (!modelGateway) return undefined
    return createBrainPluginRuntime({ runtime, modelGateway, config, logger })
  },
})
