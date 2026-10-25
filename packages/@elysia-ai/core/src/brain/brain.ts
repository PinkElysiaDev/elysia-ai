import type { BondContextPack } from '../types/bond.js'
import type { DialogueMessage } from '../types/dialogue.js'
import type { MemoryContextPack } from '../types/memory.js'
import type { ToolCall, ToolDefinition } from '../types/tools.js'

export type BrainCapability =
  | 'dialogue-generation'
  | 'dialogue-rewrite'
  | 'semantic-interpretation'
  | 'planning-support'
  | 'memory-extraction'
  | 'memory-relevance-selection'
  | 'bond-relevance-selection'
  | 'summarization'

export interface BrainRequest {
  task?: string
  lifeId?: string
  habitatId?: string
  capability?: BrainCapability
  /** 模型槽位名，由消费方插件配置传入 */
  slot?: string
  messages: DialogueMessage[]
  systemPrompt?: string
  contextWindow?: number
  memoryContext?: MemoryContextPack
  bondContext?: BondContextPack
  /** 可用工具定义（agentic 模式）；经网关透传至协议层 */
  tools?: ToolDefinition[]
  toolChoice?: unknown
  parallelToolCalls?: boolean
  metadata?: Record<string, unknown>
}

export interface BrainResponse {
  output: string
  messages?: DialogueMessage[]
  /** 模型产出的工具调用；调用方执行后以 tool 角色消息回填并再次调用 */
  toolCalls?: ToolCall[]
  capability?: BrainCapability
  metadata?: Record<string, unknown>
}

export interface BrainService {
  execute(request: BrainRequest): Promise<BrainResponse>
}
