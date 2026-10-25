import type { DialogueMessage, ToolCall, ToolDefinition } from '@elysia-ai/core'
import type { ProviderDescriptor, ModelUsage } from '@elysia-ai/core'

export interface ProviderConfig {
  id: string
  type: 'chat-completions' | 'responses' | 'gemini' | 'anthropic' | 'custom'
  apiKey: string
  baseURL: string      // API 基础域名（必填）
  endpoint?: string    // API 路径前缀（可选，各协议有默认值）
  /** type=custom：协议定义（由 gateway 在注册期解析并校验）。 */
  protocolConfig?: unknown
  model: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** o 系模型要求的 token 字段名（写入 maheshvara RawExtra.max_tokens_field）。 */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  metadata?: Record<string, unknown>
}

export interface ProviderRequest {
  messages: DialogueMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** 可用工具定义（agentic 模式） */
  tools?: ToolDefinition[]
  toolChoice?: unknown
  parallelToolCalls?: boolean
  metadata?: Record<string, unknown>
}

export interface ProviderResponse {
  output: string
  messages?: DialogueMessage[]
  /** 模型产出的工具调用 */
  toolCalls?: ToolCall[]
  provider: ProviderDescriptor
  usage?: ModelUsage
  finishReason?: string
  latencyMs?: number
  metadata?: Record<string, unknown>
}

export interface Provider {
  readonly id: string
  readonly descriptor: ProviderDescriptor
  execute(request: ProviderRequest): Promise<ProviderResponse>
}

export class ProviderError extends Error {
  public readonly retryable: boolean
  public readonly code?: string
  /** maheshvara 稳定错误分类（invalid_request/authentication/.../server），与 usage 记录 errorKind 同值域。 */
  public readonly class?: string

  constructor(
    message: string,
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    options: {
      retryable?: boolean
      code?: string
      class?: string
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = options.retryable ?? (
      statusCode === undefined || statusCode === 429 || statusCode >= 500
    )
    this.code = options.code
    this.class = options.class
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}
