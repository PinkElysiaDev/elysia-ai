import { Schema } from 'koishi'
import { createCognitionPluginRuntime } from '@elysia-ai/cognition'
import type { Config as CognitionConfig } from '@elysia-ai/cognition'
import type { BrainService, CognitionService, ConversationStore, CoreEventMap, EventBus, PersonaRegistry } from '@elysia-ai/core'
import { createElysiaPlugin, getOptionalElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/cognition'

export const name = 'elysia-ai-cognition'

export const Config: Schema<CognitionConfig> = Schema.intersect([
  Schema.object({
    behaviorThreshold: Schema.number().default(0.35)
      .description('回应意愿阈值：显著性高于此值才会进入行为决策。越低越话痨，越高越沉默。'),
    aiEnhanced: Schema.boolean().default(false)
      .description('启用 AI 增强认知推理（需在 model-gateway 配置模型槽位）。'),
  }).description('基础设置'),
  Schema.object({
    recentConversationLimit: Schema.number().default(12)
      .description('参与显著性判断的最近对话条数。'),
    salienceDirectMentionBonus: Schema.number().default(0.35)
      .description('被 @ 点名时提升的回应意愿。'),
    salienceDirectMessageBonus: Schema.number().default(0.25)
      .description('私聊场景提升的回应意愿。'),
    salienceReplyBonus: Schema.number().default(0.2)
      .description('消息是对本体的回复时提升的回应意愿。'),
    salienceQuestionBonus: Schema.number().default(0.15)
      .description('消息是疑问句时提升的回应意愿。'),
    salienceLengthFactor: Schema.number().default(0.001)
      .description('消息长度对回应意愿的加权系数。'),
  }).description('高级：显著性调参'),
  Schema.object({
    aiFallbackToRuleBased: Schema.boolean().default(true)
      .description('AI 推理失败时回退到规则判断。'),
    aiMinSalience: Schema.number().default(0.2)
      .description('触发 AI 增强的最低显著性门槛。'),
    aiModelSlot: Schema.string().default('')
      .description('AI 认知推理使用的模型槽位名（在 model-gateway 中配置），留空则使用默认槽位。'),
  }).description('高级：AI 增强'),
])

export const apply = createElysiaPlugin<
  CognitionConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
    personaRegistry?: PersonaRegistry
    conversationStore?: ConversationStore
  },
  CognitionService
>({
  name: 'elysia-ai-cognition',
  serviceFormalName: 'elysia.cognition',
  serviceLegacyName: 'elysia-ai-cognition',
  build({ ctx, runtime, config, logger }) {
    const brain = getOptionalElysiaService<BrainService>(ctx, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
    })
    if (!runtime.personaRegistry || !runtime.conversationStore) {
      logger.error('runtime registries not found; cognition plugin cannot continue', undefined, {
        plugin: 'elysia-ai-cognition',
        phase: 'apply',
      })
      return undefined
    }
    return createCognitionPluginRuntime({
      runtime: {
        context: runtime.context,
        personaRegistry: runtime.personaRegistry,
        conversationStore: runtime.conversationStore,
      },
      brain,
      config,
      logger,
    })
  },
})
