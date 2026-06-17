import type { HomeostasisState } from './homeostasis.js'
import type { ConversationEntry } from './memory.js'
import type { PerceptionResult } from './perception.js'
import type { Persona } from './persona.js'
import type { Stimulus } from './stimulus.js'

export interface CognitionContext {
  stimulusId: string
  lifeId?: string
  habitatId: string
  actorId?: string
  threadId?: string
  scopeKey: string
  stimulus: Stimulus
  persona?: Persona
  perception?: PerceptionResult
  homeostasis?: HomeostasisState
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
