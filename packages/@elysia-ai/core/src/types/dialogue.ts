import type { ToolCall } from './tools.js'

export type DialogueRole = 'system' | 'user' | 'assistant' | 'tool'

export interface DialogueMessage {
  role: DialogueRole
  content: string
  name?: string
  /** assistant 消息携带的工具调用请求（agentic 模式） */
  toolCalls?: ToolCall[]
  /** tool 角色消息对应的调用 id */
  toolCallId?: string
  metadata?: Record<string, unknown>
}

export type DialogueMode =
  | 'reply-now'
  | 'defer'
  | 'silent-update'
  | 'internal-update-only'

export interface DialogueTask {
  lifeId?: string
  habitatId?: string
  scope: {
    type: 'user' | 'thread' | 'habitat' | 'life-global'
    key: string
  }
  sourceStimulusIds: string[]
  mode: DialogueMode
  messages: DialogueMessage[]
  metadata?: Record<string, unknown>
}

export interface DialogueResult {
  taskId?: string
  output: string
  messages?: DialogueMessage[]
  metadata?: Record<string, unknown>
}
