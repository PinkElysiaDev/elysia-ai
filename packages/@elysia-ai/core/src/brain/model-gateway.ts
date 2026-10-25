import type { DialogueMessage } from '../types/dialogue.js'
import type { ToolCall, ToolDefinition } from '../types/tools.js'

export type ModelProviderType =
  | 'chat-completions'
  | 'responses'
  | 'gemini'
  | 'anthropic'
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
  /** 可用工具定义（agentic 模式），透传至协议层 */
  tools?: ToolDefinition[]
  toolChoice?: unknown
  parallelToolCalls?: boolean
  metadata?: Record<string, unknown>
}

export interface ModelGatewayResponse {
  output: string
  messages?: DialogueMessage[]
  /** 模型产出的工具调用 */
  toolCalls?: ToolCall[]
  provider?: ProviderDescriptor
  usage?: ModelUsage
  finishReason?: string
  metadata?: Record<string, unknown>
}

export interface ModelGatewayService {
  execute(request: ModelGatewayRequest): Promise<ModelGatewayResponse>
  resolveRoute?(request: ModelGatewayRequest): Promise<RoutingResult>
}
