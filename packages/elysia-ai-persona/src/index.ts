import { Schema } from 'koishi'
import { createPersonaPluginRuntime } from '@elysia-ai/persona'
import type { Config as PersonaConfig } from '@elysia-ai/persona'
import type { CoreEventMap, EventBus, PersonaRegistry, PersonaService } from '@elysia-ai/core'
import { createElysiaPlugin } from '@elysia-ai/shared'
export * from '@elysia-ai/persona'

export const name = 'elysia-ai-persona'

export const Config: Schema<PersonaConfig> = Schema.object({
  defaultName: Schema.string().default('Elysia').description('默认人格显示名称。'),
  defaultSystemPrompt: Schema.string().default('You are Elysia, a gentle virtual life. Reply warmly.')
    .description('默认人格的系统提示词。'),
  defaultTone: Schema.string().default('gentle').description('默认人格语气风格。'),
  registerDefaultPersona: Schema.boolean().default(false)
    .description('当生命体没有人格扩展时，是否注册一个默认人格。'),
})

export const apply = createElysiaPlugin<
  PersonaConfig,
  { context: { eventBus: EventBus<CoreEventMap> }, personaRegistry?: PersonaRegistry },
  PersonaService
>({
  name: 'elysia-ai-persona',
  serviceFormalName: 'elysia.persona',
  serviceLegacyName: 'elysia-ai-persona',
  build({ runtime, config, logger }) {
    if (!runtime.personaRegistry) {
      logger.error('runtime persona registry not found; persona plugin cannot continue', undefined, {
        plugin: 'elysia-ai-persona',
        phase: 'apply',
      })
      return undefined
    }
    return createPersonaPluginRuntime({
      runtime: {
        context: runtime.context,
        personaRegistry: runtime.personaRegistry,
      },
      config,
      logger,
    })
  },
})
