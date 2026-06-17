import type { ConversationEntry, Persona, Stimulus } from '@elysia-ai/core'

export interface CognitionLogger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface CognitionContext {
  stimulusId: string
  lifeId?: string
  habitatId: string
  actorId?: string
  threadId?: string
  scopeKey: string
  stimulus: Stimulus
  persona?: Persona
  recentConversation: ConversationEntry[]
  metadata?: Record<string, unknown>
}

export interface CognitionResult {
  stimulusId: string
  lifeId?: string
  scopeKey: string
  summary: string
  salience: number
  continuity: number
  shouldEnterBehavior: boolean
  reason: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface CognitionMemoryEntry {
  scopeKey: string
  stimulusId: string
  lifeId?: string
  actorId?: string
  content: string
  createdAt: number
  metadata?: Record<string, unknown>
}
