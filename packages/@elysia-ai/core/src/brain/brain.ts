import type { BondContextPack } from '../types/bond.js'
import type { DialogueMessage } from '../types/dialogue.js'
import type { MemoryContextPack } from '../types/memory.js'

export type BrainCapability =
  | 'dialogue-generation'
  | 'dialogue-rewrite'
  | 'perception-analysis'
  | 'cognition-reasoning'
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
  metadata?: Record<string, unknown>
}

export interface BrainResponse {
  output: string
  messages?: DialogueMessage[]
  capability?: BrainCapability
  metadata?: Record<string, unknown>
}

export interface BrainService {
  execute(request: BrainRequest): Promise<BrainResponse>
}
