import type { DialogueMessage } from '@elysia-ai/core'
import type { ProviderDescriptor, ModelUsage } from '@elysia-ai/core'

export interface ProviderConfig {
  id: string
  type: 'openai' | 'openai-compatible' | 'gemini' | 'claude'
  apiKey: string
  endpoint?: string
  model: string
  mode?: 'chat-completions' | 'responses'
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  metadata?: Record<string, unknown>
}

export interface ProviderRequest {
  messages: DialogueMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  metadata?: Record<string, unknown>
}

export interface ProviderResponse {
  output: string
  messages?: DialogueMessage[]
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

  constructor(
    message: string,
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    options: {
      retryable?: boolean
      code?: string
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = options.retryable ?? (
      statusCode === undefined || statusCode === 429 || statusCode >= 500
    )
    this.code = options.code
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}
