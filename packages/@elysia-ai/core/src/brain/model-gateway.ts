import type { DialogueMessage } from '../types/dialogue.js'

export type ModelProviderType =
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'openai-compatible'
  | 'custom'

export interface ProviderDescriptor {
  id: string
  type: ModelProviderType
  model: string
  endpoint?: string
  metadata?: Record<string, unknown>
}

export interface RoutingResult {
  provider: ProviderDescriptor
  reason?: string
  metadata?: Record<string, unknown>
}

export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ModelGatewayRequest {
  task?: string
  lifeId?: string
  habitatId?: string
  /** 模型槽位名（在 model-gateway 插件中配置） */
  slot?: string
  messages: DialogueMessage[]
  metadata?: Record<string, unknown>
}

export interface ModelGatewayResponse {
  output: string
  messages?: DialogueMessage[]
  provider?: ProviderDescriptor
  usage?: ModelUsage
  finishReason?: string
  metadata?: Record<string, unknown>
}

export interface ModelGatewayService {
  execute(request: ModelGatewayRequest): Promise<ModelGatewayResponse>
  resolveRoute?(request: ModelGatewayRequest): Promise<RoutingResult>
}
