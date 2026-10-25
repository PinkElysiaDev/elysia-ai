import { Schema } from 'koishi'
import { createBrainPluginRuntime } from '@elysia-ai/brain'
import type { Config as BrainConfig } from '@elysia-ai/brain'
import type { BrainService, CoreEventMap, EventBus, ModelGatewayService, PersonaRegistry } from '@elysia-ai/core'
import { createElysiaPlugin, getRequiredElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/brain'

type BrainContextBudgetConfig = Pick<BrainConfig, 'maxMemoryChars' | 'maxBondChars' | 'maxPersonaChars' | 'maxSystemPromptChars' | 'maxEstimatedTokens' | 'tokenEstimateRatio'>
type BrainPluginConfig = Omit<BrainConfig, keyof BrainContextBudgetConfig> & {
  contextBudget?: BrainContextBudgetConfig
}

export const name = 'elysia-ai-brain'

// 声明对 runtime + modelGateway 的必需依赖：cordis 会在两者就绪后再跑本插件 apply，
// 根除“读早于写”的加载竞态。
export const inject = ['elysia.runtime', 'elysia.modelGateway']

export const Config: Schema<BrainPluginConfig> = Schema.object({
  systemPrompt: Schema.string().description('兜底系统提示词：当生命体没有人格提示时使用。'),
  defaultModelSlot: Schema.string().description('大脑默认使用的 model-gateway 模型槽位。'),
  contextWindow: Schema.number().default(20).description('大脑请求中包含的最大对话历史条数。'),
  contextBudget: Schema.object({
    maxMemoryChars: Schema.number().default(4000).description('记忆上下文的最大字符数。'),
    maxBondChars: Schema.number().default(3000).description('羁绊上下文的最大字符数。'),
    maxPersonaChars: Schema.number().default(2000).description('人格上下文的最大字符数。'),
    maxSystemPromptChars: Schema.number().default(12000).description('组合后系统提示词的最大字符数。'),
    maxEstimatedTokens: Schema.number().description('提示词预估 token 上限（留空不限制）。'),
    tokenEstimateRatio: Schema.number().default(4).description('字符到 token 的预估比率。'),
  }).description('高级：上下文预算').collapse(),
})

export const apply = createElysiaPlugin<
  BrainPluginConfig,
  { context: { eventBus: EventBus<CoreEventMap> }, personaRegistry?: PersonaRegistry },
  BrainService
>({
  name: 'elysia-ai-brain',
  serviceFormalName: 'elysia.brain',
  // kernel 兼容治理：声明身份/服务/阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-brain',
    version: '0.2.0',
    services: { provides: ['elysia.brain'], consumes: ['elysia.runtime', 'elysia.modelGateway'] },
    configNamespace: 'brain',
  },
  runtimeDescription: 'runtime event bus',
  build({ ctx, runtime, config, logger }) {
    const modelGateway = getRequiredElysiaService<ModelGatewayService>(ctx, {
      formalName: 'elysia.modelGateway',
      logger,
      plugin: 'elysia-ai-brain',
      description: 'model gateway service',
    })
    if (!modelGateway) return undefined
    const { contextBudget, ...baseConfig } = config
    return createBrainPluginRuntime({
      runtime,
      modelGateway,
      config: { ...baseConfig, ...contextBudget } as BrainConfig,
      logger,
    })
  },
})
