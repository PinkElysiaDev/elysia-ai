import { Schema, type Context } from 'koishi'
import {
  createModelGatewayPluginRuntime,
  formatGatewayFailures,
  formatGatewayHealth,
  formatGatewayRegistry,
  formatGatewaySlots,
} from '@elysia-ai/model-gateway'
import type { Config as ModelGatewayConfig, DefaultModelGatewayService, GatewayFailureEventSource } from '@elysia-ai/model-gateway'
import type { CoreEventMap, EventBus } from '@elysia-ai/core'
import { combinePreflightResults, createPreflightResult, getOptionalElysiaService, getRequiredElysiaService, issue, registerElysiaService, type PreflightResult } from '@elysia-ai/shared'
export * from '@elysia-ai/model-gateway'

export const name = 'elysia-ai-model-gateway'

const SlotSchema = Schema.object({
  type: Schema.union([
    Schema.const('openai' as const),
    Schema.const('openai-compatible' as const),
    Schema.const('gemini' as const),
    Schema.const('claude' as const),
  ]).required().description('Provider type.'),
  apiKey: Schema.string().role('secret').required().description('API key.'),
  endpoint: Schema.string().description('Provider endpoint.'),
  model: Schema.string().required().description('Model name.'),
  mode: Schema.union([
    Schema.const('chat-completions' as const),
    Schema.const('responses' as const),
  ]).default('chat-completions').description('Provider request mode.'),
  maxTokens: Schema.number().default(4096).description('Maximum output tokens.'),
  temperature: Schema.number().default(0.7).description('Sampling temperature.'),
  timeoutMs: Schema.number().description('Provider request timeout in milliseconds.'),
}).description('Model provider slot.')


const ProviderSchema = Schema.object({
  type: Schema.union([
    Schema.const('openai' as const),
    Schema.const('openai-compatible' as const),
    Schema.const('gemini' as const),
    Schema.const('claude' as const),
  ]).required().description('Provider type.'),
  model: Schema.string().required().description('Default model name.'),
  apiKey: Schema.string().role('secret').description('Inline API key. Prefer apiKeyEnv in production.'),
  apiKeyEnv: Schema.string().description('Environment variable that contains the API key.'),
  endpoint: Schema.string().description('Provider endpoint.'),
  baseURL: Schema.string().description('Provider base URL alias.'),
  mode: Schema.union([
    Schema.const('chat-completions' as const),
    Schema.const('responses' as const),
  ]).default('chat-completions').description('Provider request mode.'),
  maxTokens: Schema.number().default(4096).description('Maximum output tokens.'),
  temperature: Schema.number().default(0.7).description('Sampling temperature.'),
  timeoutMs: Schema.number().description('Provider request timeout in milliseconds.'),
}).description('Production provider configuration.')

const ProviderSlotSchema = Schema.object({
  provider: Schema.string().required().description('Provider id from providers.'),
  model: Schema.string().description('Per-slot model override.'),
  maxTokens: Schema.number().description('Per-slot maximum output tokens.'),
  temperature: Schema.number().description('Per-slot sampling temperature.'),
  timeoutMs: Schema.number().description('Per-slot request timeout in milliseconds.'),
}).description('Production model slot referencing a provider.')

export const Config: Schema<ModelGatewayConfig> = Schema.intersect([
  Schema.object({
    providers: Schema.dict(ProviderSchema).description('生产环境 provider，按 provider id 索引。'),
    providerSlots: Schema.dict(ProviderSlotSchema).description('引用 provider id 的生产环境槽位。'),
    slots: Schema.dict(SlotSchema).description('命名 provider 槽位（兼容旧式直配）。'),
    defaultSlot: Schema.string().description('默认 provider 槽位键。'),
  }).description('基础设置'),
  Schema.object({
    retry: Schema.object({
      maxRetries: Schema.number().default(3).description('每个 provider 的最大重试次数。'),
      baseDelayMs: Schema.number().default(500).description('初始重试延迟（毫秒）。'),
      maxDelayMs: Schema.number().default(5000).description('最大重试延迟（毫秒）。'),
    }).description('重试策略。'),
    circuitBreaker: Schema.object({
      enabled: Schema.boolean().default(false).description('启用 provider 熔断器。'),
      failureThreshold: Schema.number().default(3).description('触发熔断的连续失败次数。'),
      cooldownMs: Schema.number().default(30000).description('熔断冷却时长（毫秒）。'),
    }).description('provider 熔断策略。'),
    fallback: Schema.object({
      enabled: Schema.boolean().default(false).description('启用 provider 槽位回退。'),
      slots: Schema.dict(Schema.array(String)).description('按源槽位键配置的回退槽位链。'),
      fallbackOnNonRetryable: Schema.boolean().default(false).description('遇到不可重试错误时也回退。'),
    }).description('回退槽位策略。'),
  }).description('高级：网关韧性（重试/熔断/回退）'),
])


const PROVIDER_TYPES = new Set(['openai', 'openai-compatible', 'gemini', 'claude'])

function assertProviderType(providerId: string, type: unknown): asserts type is 'openai' | 'openai-compatible' | 'gemini' | 'claude' {
  if (typeof type !== 'string' || !PROVIDER_TYPES.has(type)) {
    throw new Error(`elysia-ai-model-gateway: provider "${providerId}" has unknown type "${String(type)}"`)
  }
}

function collectConfiguredSlots(config: ModelGatewayConfig): Set<string> {
  return new Set([
    ...Object.keys(config.slots ?? {}),
    ...Object.keys(config.providerSlots ?? {}),
  ])
}

export function validateModelGatewayConfig(config: ModelGatewayConfig): void {
  for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
    assertProviderType(providerId, provider.type)
    if (!provider.apiKey && !provider.apiKeyEnv) {
      throw new Error(`elysia-ai-model-gateway: provider "${providerId}" requires apiKey or apiKeyEnv`)
    }
  }

  for (const [slotName, slot] of Object.entries(config.providerSlots ?? {})) {
    if (!config.providers?.[slot.provider]) {
      throw new Error(`elysia-ai-model-gateway: slot "${slotName}" references unknown provider "${slot.provider}"`)
    }
  }

  for (const [slotName, slot] of Object.entries(config.slots ?? {})) {
    assertProviderType(`slot:${slotName}`, slot.type)
    if (!slot.apiKey) {
      throw new Error(`elysia-ai-model-gateway: legacy slot "${slotName}" requires apiKey`)
    }
  }

  const slots = collectConfiguredSlots(config)
  for (const [sourceSlot, fallbackSlots] of Object.entries(config.fallback?.slots ?? {})) {
    if (!slots.has(sourceSlot)) {
      throw new Error(`elysia-ai-model-gateway: fallback source slot "${sourceSlot}" is not configured`)
    }
    for (const fallbackSlot of fallbackSlots) {
      if (!slots.has(fallbackSlot)) {
        throw new Error(`elysia-ai-model-gateway: fallback slot "${fallbackSlot}" is not configured`)
      }
    }
  }
}


export function preflightModelGatewayConfig(config: ModelGatewayConfig): PreflightResult {
  try {
    validateModelGatewayConfig(config)
    return createPreflightResult([], {
      plugin: 'elysia-ai-model-gateway',
      providerCount: Object.keys(config.providers ?? {}).length,
      slotCount: Object.keys(config.providerSlots ?? {}).length + Object.keys(config.slots ?? {}).length,
      fallbackEnabled: config.fallback?.enabled === true,
    })
  } catch (error) {
    return createPreflightResult([
      issue('elysia-ai-model-gateway', 'gateway.invalid-config', 'error', error instanceof Error ? error.message : String(error)),
    ], { plugin: 'elysia-ai-model-gateway' })
  }
}

export function runElysiaPreflight(configs: {
  modelGateway?: ModelGatewayConfig
  memory?: { preflight?: () => PreflightResult }
  bond?: { preflight?: () => PreflightResult }
}): PreflightResult {
  const results: PreflightResult[] = []
  if (configs.modelGateway) results.push(preflightModelGatewayConfig(configs.modelGateway))
  if (configs.memory?.preflight) results.push(configs.memory.preflight())
  if (configs.bond?.preflight) results.push(configs.bond.preflight())
  return combinePreflightResults(results)
}

type CommandLike = {
  action(handler: (...args: unknown[]) => unknown): unknown
}

function registerDebugCommands(ctx: Context, service: DefaultModelGatewayService, config: ModelGatewayConfig) {
  const command = (ctx as unknown as { command?: (...args: unknown[]) => CommandLike }).command
  if (typeof command !== 'function') return

  command.call(ctx, 'elysia.gateway.slots', 'Elysia Model Gateway 模型槽位', { authority: 4 })
    .action(() => formatGatewaySlots(service, config.defaultSlot))

  command.call(ctx, 'elysia.gateway.registry', 'Elysia Model Gateway provider 注册表', { authority: 4 })
    .action(() => formatGatewayRegistry(service))

  command.call(ctx, 'elysia.gateway.health [providerId:string]', 'Elysia Model Gateway provider 健康状态', { authority: 4 })
    .action((_argv: unknown, providerId?: string) => formatGatewayHealth(service, providerId))

  command.call(ctx, 'elysia.gateway.failures [limit:number]', 'Elysia Model Gateway 最近失败记录', { authority: 4 })
    .action((_argv: unknown, limit?: number) => {
      const observatory = getOptionalElysiaService<{ service?: GatewayFailureEventSource } & GatewayFailureEventSource>(ctx, {
        formalName: 'elysia.observatory',
        legacyName: 'elysia-ai-observatory',
        plugin: 'elysia-ai-model-gateway',
      })
      return formatGatewayFailures(observatory?.service ?? observatory, limit ?? 10)
    })
}

export function apply(ctx: Context, config: ModelGatewayConfig) {
  const logger = ctx.logger('elysia-ai-model-gateway')
  const runtime = getRequiredElysiaService<{ context: { eventBus: EventBus<CoreEventMap> } }>(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    logger,
    plugin: 'elysia-ai-model-gateway',
    description: 'runtime event bus',
  })

  if (!runtime?.context?.eventBus) return

  validateModelGatewayConfig(config)

  const gatewayRuntime = createModelGatewayPluginRuntime({ runtime, config, logger })

  registerElysiaService(ctx, {
    formalName: 'elysia.modelGateway',
    legacyName: 'elysia-ai-model-gateway',
    service: gatewayRuntime.service,
    logger,
    plugin: 'elysia-ai-model-gateway',
  })

  registerDebugCommands(ctx, gatewayRuntime.service, config)
  ctx.on('dispose', () => gatewayRuntime.dispose())
}
