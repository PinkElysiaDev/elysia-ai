import type {
  EventBus,
  CoreEventMap,
  ModelGatewayRequest,
  ModelGatewayResponse,
  ModelGatewayService,
  RoutingResult,
} from '@elysia-ai/core'
import type { CircuitBreakerConfig, FallbackConfig, ModelGatewayConfig, ModelProviderConfig, ModelProviderSlotConfig, RetryConfig, SlotDeclaration } from './config/index.js'
import type { ProviderConfig, ProviderResponse } from './providers/types.js'
import { ProviderError } from './providers/types.js'
import { resolveProtocolDefinition } from './providers/custom.js'
import { CUSTOM_PROTOCOL_PRESETS } from '@elysia-ai/protocol-custom'
import {
  createGatewayDiagnostics,
  finalizeGatewayDiagnostics,
  recordGatewayAttemptFailure,
  recordGatewayAttemptSuccess,
  type MutableGatewayDiagnostics,
} from './diagnostics/index.js'
import {
  ProviderHealthTracker,
  type ProviderHealthSnapshot,
} from './health/index.js'
import { ProviderRegistry } from './registry/index.js'
import { GatewayRouter } from './routing/index.js'

export const internalName = 'elysia-ai-model-gateway'

export interface Config extends ModelGatewayConfig {}

export interface ProviderRegistryFactoryOptions {
  config: Config
  logger: PluginLoggerLike
}

export type ProviderRegistryFactory = (options: ProviderRegistryFactoryOptions) => ProviderRegistry

export type PluginLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Retry 宸ュ叿鍑芥暟
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
}

const DEFAULT_CIRCUIT_BREAKER: Required<CircuitBreakerConfig> = {
  enabled: false,
  failureThreshold: 3,
  cooldownMs: 30000,
}

const DEFAULT_FALLBACK: Required<FallbackConfig> = {
  enabled: false,
  slots: {},
  fallbackOnNonRetryable: false,
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeDelay(attempt: number, config: Required<RetryConfig>): number {
  return Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs)
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.retryable
  }
  // P2-10 白名单：仅网络/超时类原始错误可重试。此前非 ProviderError 一律
  // 可重试——res.json() 的 SyntaxError（200 返回 HTML/截断体）会白重试 3 次
  // 并击穿熔断。decode 断言、解析错误走 invalid-response(retryable:false)。
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    if (error instanceof TypeError) return true // fetch 网络层（DNS/连接重置）
  }
  return false
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return 'unknown-time'
  return new Date(timestamp).toISOString()
}

function formatProviderDescriptor(provider: { id: string, descriptor: any }): string {
  const descriptor = provider.descriptor
  return [
    `- ${provider.id}`,
    `  type: ${descriptor.type}`,
    `  model: ${descriptor.model}`,
    descriptor.endpoint ? `  endpoint: ${descriptor.endpoint}` : undefined,
  ].filter(Boolean).join('\n')
}

export function formatGatewaySlots(service: DefaultModelGatewayService, defaultSlot?: string): string {
  const registry = service.getRegistry()
  const lines = [
    'Model Gateway Slots',
    '',
    `defaultSlot: ${defaultSlot ?? 'not configured'}`,
  ]

  for (const slotName of registry.getSlotNames()) {
    const provider = registry.resolveSlot(slotName)
    if (!provider) {
      lines.push('', `- ${slotName} -> missing provider`)
      continue
    }

    lines.push(
      '',
      `- ${slotName} -> ${provider.id}`,
      `  type: ${provider.descriptor.type}`,
      `  model: ${provider.descriptor.model}`,
      provider.descriptor.endpoint ? `  endpoint: ${provider.descriptor.endpoint}` : '',
    )
  }

  return lines.filter((line, index, array) => line !== '' || array[index - 1] !== '').join('\n')
}

export function formatGatewayRegistry(service: DefaultModelGatewayService): string {
  const providers = service.getRegistry().getAll()
  if (providers.length === 0) return 'Registered Providers\n\nNo providers registered.'

  return [
    'Registered Providers',
    '',
    providers.map(formatProviderDescriptor).join('\n\n'),
  ].join('\n')
}

function formatHealthSnapshot(snapshot: ProviderHealthSnapshot): string {
  return [
    `- ${snapshot.providerId}`,
    `  status: ${snapshot.status}`,
    `  recentSuccesses: ${snapshot.recentSuccesses}`,
    `  recentFailures: ${snapshot.recentFailures}`,
    `  consecutiveFailures: ${snapshot.consecutiveFailures}`,
    `  averageLatencyMs: ${snapshot.averageLatencyMs ?? 'n/a'}`,
    `  lastErrorCode: ${snapshot.lastErrorCode ?? 'n/a'}`,
    `  lastErrorClass: ${snapshot.lastErrorClass ?? 'n/a'}`,
    `  lastSuccessAt: ${formatTimestamp(snapshot.lastSuccessAt)}`,
    `  lastFailureAt: ${formatTimestamp(snapshot.lastFailureAt)}`,
  ].join('\n')
}

export function formatGatewayHealth(service: DefaultModelGatewayService, providerId?: string): string {
  if (providerId) {
    return [
      `Provider Health: ${providerId}`,
      '',
      formatHealthSnapshot(service.getHealthSnapshot(providerId)),
    ].join('\n')
  }

  const snapshots = service.getHealthSnapshots()
  if (snapshots.length === 0) return 'Provider Health\n\nNo provider health snapshots recorded.'

  return [
    'Provider Health',
    '',
    snapshots.map(formatHealthSnapshot).join('\n\n'),
  ].join('\n')
}

function getNested(record: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = record
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export type GatewayFailureEventSource = {
  getRecentEvents(limit?: number): Array<{
    event: string
    timestamp: number
    metadata?: Record<string, unknown>
  }>
}

export function formatGatewayFailures(observatory: GatewayFailureEventSource | undefined, limit = 10): string {
  if (!observatory) {
    return 'Observatory service not available. Please enable elysia-ai-observatory.'
  }

  const failures = observatory.getRecentEvents(limit * 5)
    .filter((event) => event.event === 'gateway.failed')
    .slice(-limit)

  if (failures.length === 0) return 'Recent Gateway Failures\n\nNo recent gateway failures.'

  const lines = failures.map((event) => {
    const metadata = event.metadata
    const diagnostics = getNested(metadata, ['diagnostics']) as Record<string, unknown> | undefined
    const route = getNested(diagnostics, ['route']) as Record<string, unknown> | undefined
    const finalErrorCode = getNested(diagnostics, ['finalErrorCode'])
      ?? getNested(metadata, ['error', 'code'])
      ?? 'unknown-error'
    const attempts = Array.isArray(diagnostics?.['attempts'])
      ? diagnostics['attempts'] as Array<Record<string, unknown>>
      : []
    const lastAttemptClass = [...attempts].reverse().find((attempt) => attempt['errorClass'] !== undefined)?.['errorClass']
    const finalErrorClass = lastAttemptClass ?? getNested(metadata, ['error', 'class'])
    const selectedFallbackSlot = getNested(diagnostics, ['selectedFallbackSlot'])

    return [
      `- ${formatTimestamp(event.timestamp)}`,
      `  provider: ${String(getNested(route, ['providerId']) ?? 'unknown')}`,
      `  slot: ${String(getNested(route, ['slot']) ?? 'unknown')}`,
      `  code: ${String(finalErrorCode)}`,
      finalErrorClass ? `  class: ${String(finalErrorClass)}` : undefined,
      selectedFallbackSlot ? `  fallback: ${String(selectedFallbackSlot)}` : undefined,
    ].filter(Boolean).join('\n')
  })

  return [
    'Recent Gateway Failures',
    '',
    lines.join('\n\n'),
  ].join('\n')
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Gateway Service
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€


function resolveProviderApiKey(providerId: string, config: ModelProviderConfig): string {
  if (!config.apiKey) {
    throw new Error(`model-gateway provider "${providerId}" requires apiKey`)
  }
  return config.apiKey
}

function toProviderConfig(providerId: string, config: ModelProviderConfig, protocols?: Record<string, unknown>): Omit<ProviderConfig, 'model'> {
  return {
    id: providerId,
    type: config.type,
    apiKey: resolveProviderApiKey(providerId, config),
    baseURL: config.baseURL,
    endpoint: config.endpoint,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    maxTokensField: config.maxTokensField,
    // type=custom：解析协议引用（protocols 字典优先，其次内置 preset id）。
    protocolConfig: config.type === 'custom'
      ? resolveProtocolDefinition(config.protocol, protocols, CUSTOM_PROTOCOL_PRESETS)
      : undefined,
    metadata: config.metadata,
  }
}

function registerConfiguredProviderSlot(
  registry: ProviderRegistry,
  slotName: string,
  slotConfig: ModelProviderSlotConfig,
  providerConfig: ModelProviderConfig,
  protocols?: Record<string, unknown>,
): void {
  const providerId = `slot:${slotName}`
  registry.register({
    ...toProviderConfig(slotConfig.provider, providerConfig, protocols),
    id: providerId,
    model: slotConfig.model,
    maxTokens: slotConfig.maxTokens ?? providerConfig.maxTokens,
    temperature: slotConfig.temperature ?? providerConfig.temperature,
    timeoutMs: slotConfig.timeoutMs ?? providerConfig.timeoutMs,
  })
  registry.registerSlot(slotName, providerId)
}

function registerConfiguredProviders(registry: ProviderRegistry, config: Config): void {
  // Providers 不再直接注册，仅作为配置源

  if (config.providerSlots) {
    for (const [slotName, slotConfig] of Object.entries(config.providerSlots)) {
      const providerConfig = config.providers?.[slotConfig.provider]
      if (!providerConfig) throw new Error(`model-gateway slot "${slotName}" references unknown provider "${slotConfig.provider}"`)
      registerConfiguredProviderSlot(registry, slotName, slotConfig, providerConfig, config.protocols)
    }
  }
}

export class DefaultModelGatewayService implements ModelGatewayService {
  private readonly registry: ProviderRegistry
  private readonly router: GatewayRouter
  private readonly healthTracker: ProviderHealthTracker
  private readonly retryConfig: Required<RetryConfig>
  private readonly fallbackConfig: Required<FallbackConfig>
  private readonly declaredSlots = new Map<string, SlotDeclaration>()

  constructor(
    config: Config,
    private readonly eventBus?: EventBus<CoreEventMap>,
    registry?: ProviderRegistry,
  ) {
    this.registry = registry ?? new ProviderRegistry()
    this.router = new GatewayRouter(this.registry)
    this.healthTracker = new ProviderHealthTracker({
      circuitBreakerEnabled: config.enableCircuitBreaker ?? false,
      circuitBreakerFailureThreshold: config.failureThreshold ?? 3,
      circuitBreakerCooldownMs: config.cooldownMs ?? 30000,
    })
    this.retryConfig = {
      maxRetries: config.enableRetry === false ? 0 : (config.maxRetries ?? 3),
      baseDelayMs: config.baseDelayMs ?? 500,
      maxDelayMs: config.maxDelayMs ?? 5000,
    }
    this.fallbackConfig = {
      enabled: config.enableFallback ?? false,
      slots: config.slots ?? {},
      fallbackOnNonRetryable: config.fallbackOnNonRetryable ?? false,
    }

    registerConfiguredProviders(this.registry, config)

    if (config.defaultSlot) {
      this.registry.setDefaultSlot(config.defaultSlot)
    }
  }

  async resolveRoute(request: ModelGatewayRequest): Promise<RoutingResult> {
    return this.router.resolve(request)
  }

  async execute(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    await this.eventBus?.emit('gateway.requested', { request })

    const candidateSlots = this.resolveCandidateSlots(request)
    let diagnostics: MutableGatewayDiagnostics | undefined
    let lastError: unknown
    const failures: Array<{ slot?: string, providerId?: string, error: unknown }> = []

    for (let index = 0; index < candidateSlots.length; index++) {
      const slot = candidateSlots[index]
      const candidateRequest: ModelGatewayRequest = { ...request, slot }

      let route: RoutingResult
      try {
        route = this.router.resolve(candidateRequest)
      } catch (error) {
        lastError = error
        failures.push({ slot, error })
        if (index < candidateSlots.length - 1 && this.shouldFallback(error)) {
          continue
        }
        throw error
      }

      if (!diagnostics) {
        diagnostics = createGatewayDiagnostics(candidateRequest, route)
        if (candidateSlots.length > 1) {
          diagnostics.fallbackChain = candidateSlots.filter((value): value is string => value !== undefined)
        }
      } else {
        diagnostics.failedOver = true
        diagnostics.selectedFallbackSlot = slot
        diagnostics.route = {
          slot,
          providerId: route.provider.id,
          providerType: route.provider.type,
          model: route.provider.model,
          reason: route.reason,
        }
      }

      const provider = this.registry.get(route.provider.id)

      if (!provider) {
        const error = new ProviderError(
          `Routed provider "${route.provider.id}" not found in registry`,
          route.provider.id,
          undefined,
          undefined,
          { retryable: false, code: 'provider-not-found' },
        )
        lastError = error
        failures.push({ slot, providerId: route.provider.id, error })

        if (index < candidateSlots.length - 1 && this.shouldFallback(error)) {
          continue
        }

        const finalError = this.createFinalFallbackError(candidateSlots, failures, lastError)
        await this.eventBus?.emit('gateway.failed', {
          request,
          error: finalError,
          diagnostics: finalizeGatewayDiagnostics(diagnostics),
          healthSnapshots: this.getHealthSnapshots(),
        } as any)
        throw finalError
      }

      try {
        const providerResponse = await this.executeWithRetry(route.provider.id, candidateRequest, diagnostics)
        const gatewayDiagnostics = finalizeGatewayDiagnostics(diagnostics)

        const response: ModelGatewayResponse = {
          output: providerResponse.output,
          messages: providerResponse.messages,
          toolCalls: providerResponse.toolCalls,
          provider: providerResponse.provider,
          usage: providerResponse.usage,
          finishReason: providerResponse.finishReason,
          metadata: {
            ...providerResponse.metadata,
            routingReason: route.reason,
            source: 'elysia-ai-model-gateway',
            gatewayDiagnostics,
          },
        }

        await this.eventBus?.emit('gateway.responded', {
          request,
          diagnostics: gatewayDiagnostics,
          healthSnapshots: this.getHealthSnapshots(),
          response,
        } as any)
        return response
      } catch (error) {
        lastError = error
        failures.push({ slot, providerId: route.provider.id, error })

        if (index < candidateSlots.length - 1 && this.shouldFallback(error)) {
          if (diagnostics.fallbackChain?.length) {
            diagnostics.failedOver = true
          }
          continue
        }

        const finalError = this.createFinalFallbackError(candidateSlots, failures, lastError)
        await this.eventBus?.emit('gateway.failed', {
          request,
          error: finalError,
          diagnostics: finalizeGatewayDiagnostics(diagnostics),
          healthSnapshots: this.getHealthSnapshots(),
        } as any)
        throw finalError
      }
    }

    const finalError = this.createFinalFallbackError(candidateSlots, failures, lastError)
    if (diagnostics) {
      await this.eventBus?.emit('gateway.failed', {
        request,
        error: finalError,
        diagnostics: finalizeGatewayDiagnostics(diagnostics),
        healthSnapshots: this.getHealthSnapshots(),
      } as any)
    }
    throw finalError
  }

  private resolveCandidateSlots(request: ModelGatewayRequest): Array<string | undefined> {
    const primarySlot = request.slot

    if (!this.fallbackConfig.enabled || !primarySlot) {
      return [primarySlot]
    }

    return [
      primarySlot,
      ...(this.fallbackConfig.slots[primarySlot] ?? []),
    ]
  }

  private shouldFallback(error: unknown): boolean {
    if (!this.fallbackConfig.enabled) return false

    if (error instanceof ProviderError) {
      return error.code === 'circuit-open'
        || error.retryable
        || this.fallbackConfig.fallbackOnNonRetryable
    }

    return true
  }

  private createFinalFallbackError(
    candidateSlots: Array<string | undefined>,
    failures: Array<{ slot?: string, providerId?: string, error: unknown }>,
    lastError: unknown,
  ): ProviderError {
    if (!this.fallbackConfig.enabled || failures.length <= 1) {
      if (lastError instanceof ProviderError) return lastError
      if (lastError instanceof Error) {
        return new ProviderError(
          lastError.message,
          failures[failures.length - 1]?.providerId ?? 'unknown',
          undefined,
          undefined,
          {
            retryable: false,
            code: lastError.name,
            cause: lastError,
          },
        )
      }
    }

    const lastProviderError = lastError instanceof ProviderError ? lastError : undefined
    const chain = candidateSlots.filter((value): value is string => value !== undefined)

    return new ProviderError(
      `All fallback slots failed: ${chain.join(' -> ')}`,
      failures[failures.length - 1]?.providerId ?? 'unknown',
      lastProviderError?.statusCode,
      {
        slots: chain,
        failures: failures.map((failure) => ({
          slot: failure.slot,
          providerId: failure.providerId,
          code: failure.error instanceof ProviderError
            ? failure.error.code
            : failure.error instanceof Error
              ? failure.error.name
              : 'unknown-error',
          statusCode: failure.error instanceof ProviderError ? failure.error.statusCode : undefined,
          retryable: failure.error instanceof ProviderError ? failure.error.retryable : undefined,
          message: failure.error instanceof Error ? failure.error.message : String(failure.error),
        })),
      },
      {
        retryable: false,
        code: 'all-fallbacks-failed',
        cause: lastError,
      },
    )
  }

  private async executeWithRetry(
    providerId: string,
    request: ModelGatewayRequest,
    diagnostics: MutableGatewayDiagnostics,
  ): Promise<ProviderResponse> {
    const provider = this.registry.get(providerId)!
    const route = this.router.resolve(request)

    if (!this.healthTracker.isAvailable(providerId)) {
      const error = new ProviderError(
        `Provider "${providerId}" circuit is open`,
        providerId,
        undefined,
        this.healthTracker.getSnapshot(providerId),
        {
          retryable: false,
          code: 'circuit-open',
        },
      )
      recordGatewayAttemptFailure(diagnostics, {
        providerId,
        attempt: 0,
        startedAt: Date.now(),
        latencyMs: 0,
        error,
      })
      throw error
    }

    this.healthTracker.markProbeStarted(providerId)

    let lastError: unknown
    // P2-9：熔断按请求级计数——一次请求内的重试 attempt 不重复计入
    // consecutiveFailures（默认 3 次 attempt 连败即误开 30s 熔断）。
    let healthFailureRecorded = false
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      const attemptStartedAt = Date.now()
      try {
        const response = await provider.execute({
          messages: request.messages,
          model: route.provider.model,
          tools: request.tools,
          toolChoice: request.toolChoice,
          parallelToolCalls: request.parallelToolCalls,
          metadata: request.metadata,
          maxTokens: request.metadata?.maxTokens as number | undefined,
          temperature: request.metadata?.temperature as number | undefined,
          timeoutMs: request.metadata?.timeoutMs as number | undefined,
        })
        const latencyMs = response.latencyMs ?? Date.now() - attemptStartedAt
        this.healthTracker.recordSuccess(providerId, latencyMs)
        recordGatewayAttemptSuccess(diagnostics, {
          providerId,
          attempt,
          startedAt: attemptStartedAt,
          latencyMs,
        })
        return response
      } catch (error) {
        lastError = error
        if (!healthFailureRecorded) {
          this.healthTracker.recordFailure(providerId, error)
          healthFailureRecorded = true
        }
        recordGatewayAttemptFailure(diagnostics, {
          providerId,
          attempt,
          startedAt: attemptStartedAt,
          latencyMs: Date.now() - attemptStartedAt,
          error,
        })
        if (attempt < this.retryConfig.maxRetries && isRetryableError(error)) {
          await sleep(computeDelay(attempt, this.retryConfig))
          continue
        }
        break
      }
    }

    throw new ProviderError(
      `Provider "${providerId}" failed after ${this.retryConfig.maxRetries + 1} attempt(s)`,
      providerId,
      lastError instanceof ProviderError ? lastError.statusCode : undefined,
      lastError instanceof ProviderError ? lastError.responseBody : undefined,
      {
        retryable: isRetryableError(lastError),
        code: lastError instanceof ProviderError ? lastError.code : 'provider-failed',
        cause: lastError,
      },
    )
  }

  getRegistry(): ProviderRegistry {
    return this.registry
  }

  getHealthSnapshot(providerId: string): ProviderHealthSnapshot {
    return this.healthTracker.getSnapshot(providerId)
  }

  getHealthSnapshots(): ProviderHealthSnapshot[] {
    return this.healthTracker.getAllSnapshots()
  }

  declareSlot(declaration: SlotDeclaration): void {
    if (this.declaredSlots.has(declaration.slotName)) {
      console.warn(`[model-gateway] Slot "${declaration.slotName}" already declared, overwriting`)
    }
    this.declaredSlots.set(declaration.slotName, declaration)
  }

  getDeclaredSlots(): SlotDeclaration[] {
    return Array.from(this.declaredSlots.values())
  }

  getDeclaredSlot(slotName: string): SlotDeclaration | undefined {
    return this.declaredSlots.get(slotName)
  }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Plugin apply
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface ModelGatewayPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> } }
  config: Config
  logger: PluginLoggerLike
  providerRegistry?: ProviderRegistry
  providerRegistryFactory?: ProviderRegistryFactory
}

export interface ModelGatewayPluginRuntime {
  service: DefaultModelGatewayService
  dispose(): void
}

export function createModelGatewayPluginRuntime(options: ModelGatewayPluginRuntimeOptions): ModelGatewayPluginRuntime {
  const { runtime, config, logger } = options

  logger.info('model-gateway plugin apply started', {
    plugin: 'elysia-ai-model-gateway',
    phase: 'apply',
    slotCount: config.providerSlots ? Object.keys(config.providerSlots).length : 0,
    providerCount: config.providers ? Object.keys(config.providers).length : 0,
  })

  const providerRegistry = options.providerRegistry ?? options.providerRegistryFactory?.({ config, logger })
  const service = new DefaultModelGatewayService(config, runtime.context.eventBus, providerRegistry)

  logger.info('model-gateway plugin ready', {
    plugin: 'elysia-ai-model-gateway',
    phase: 'apply',
    slotNames: service.getRegistry().getSlotNames(),
    defaultSlot: config.defaultSlot,
  })

  return {
    service,
    dispose() {},
  }
}

export { ProviderRegistry } from './registry/index.js'
export { GatewayRouter } from './routing/index.js'
export { ProviderHealthTracker } from './health/index.js'
export type { GatewayDiagnostics, GatewayAttemptDiagnostics } from './diagnostics/index.js'
export type { ProviderHealthSnapshot, ProviderHealthStatus } from './health/index.js'
export type { ProviderConfig } from './providers/types.js'
export type { ModelProviderConfig, ModelProviderSlotConfig } from './config/index.js'
export { ProviderError } from './providers/types.js'
export type { Provider, ProviderRequest, ProviderResponse } from './providers/types.js'
