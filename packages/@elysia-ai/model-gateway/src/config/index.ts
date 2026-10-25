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

export interface SlotDeclaration {
  slotName: string
  description: string
  suggestedModels?: string[]
  required: boolean
  defaultConfig?: {
    maxTokens?: number
    temperature?: number
  }
  plugin?: string  // 声明该 slot 的插件名称
}

export interface ModelProviderConfig {
  type: 'chat-completions' | 'responses' | 'gemini' | 'anthropic' | 'custom'
  apiKey: string
  baseURL: string      // API 基础域名（必填）
  endpoint?: string    // API 路径前缀（可选，各协议有默认值）
  /**
   * type=custom 时的协议引用：protocols 字典键或内置 preset id
   * （openai-chat / anthropic-messages / gemini-generate / openai-responses）。
   */
  protocol?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** o 系模型要求的 token 上限字段名（默认 max_tokens）。 */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
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
  /** Provider 注册表，按 provider id 索引。定义可用的 API 服务。 */
  providers?: Record<string, ModelProviderConfig>
  /**
   * 自定义协议定义（type=custom 的 provider 经 protocol 字段引用）：
   * 值为 @elysia-ai/protocol-custom 的 CustomProtocolConfig JSON；
   * 注册时整体校验，非法配置启动即报错。
   */
  protocols?: Record<string, unknown>
  /** 模型槽位，引用 provider id 并指定模型。按用途分配模型。 */
  providerSlots?: Record<string, ModelProviderSlotConfig>
  /** 默认槽位名 */
  defaultSlot?: string
  /** 启用重试策略 */
  enableRetry?: boolean
  /** 每个 provider 的最大重试次数 */
  maxRetries?: number
  /** 初始重试延迟（毫秒） */
  baseDelayMs?: number
  /** 最大重试延迟（毫秒） */
  maxDelayMs?: number
  /** 启用 provider 熔断器 */
  enableCircuitBreaker?: boolean
  /** 触发熔断的连续失败次数 */
  failureThreshold?: number
  /** 熔断冷却时长（毫秒） */
  cooldownMs?: number
  /** 启用回退槽位策略 */
  enableFallback?: boolean
  /** 按源槽位键配置的回退槽位链 */
  slots?: Record<string, string[]>
  /** 遇到不可重试错误时也回退 */
  fallbackOnNonRetryable?: boolean
}
