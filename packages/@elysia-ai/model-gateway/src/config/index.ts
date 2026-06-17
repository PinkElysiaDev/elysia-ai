export interface RetryConfig {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface CircuitBreakerConfig {
  enabled?: boolean
  failureThreshold?: number
  cooldownMs?: number
}

export interface FallbackConfig {
  enabled?: boolean
  slots?: Record<string, string[]>
  fallbackOnNonRetryable?: boolean
}

export interface ModelSlotConfig {
  type: 'openai' | 'openai-compatible' | 'gemini' | 'claude'
  apiKey: string
  endpoint?: string
  model: string
  mode?: 'chat-completions' | 'responses'
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface ModelProviderConfig {
  type: 'openai' | 'openai-compatible' | 'gemini' | 'claude'
  model: string
  apiKey?: string
  apiKeyEnv?: string
  endpoint?: string
  baseURL?: string
  mode?: 'chat-completions' | 'responses'
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  metadata?: Record<string, unknown>
}

export interface ModelProviderSlotConfig {
  provider: string
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface ModelGatewayConfig {
  /** Production provider registry keyed by provider id. */
  providers?: Record<string, ModelProviderConfig>
  /** Production slots reference provider ids and optional per-slot overrides. */
  providerSlots?: Record<string, ModelProviderSlotConfig>
  /** Legacy direct slot configuration retained for compatibility. */
  slots?: Record<string, ModelSlotConfig>
  /** 默认槽位名 */
  defaultSlot?: string
  /** 容错重试配置 */
  retry?: RetryConfig
  /** 熔断配置 */
  circuitBreaker?: CircuitBreakerConfig
  /** fallback slot 配置 */
  fallback?: FallbackConfig
}
