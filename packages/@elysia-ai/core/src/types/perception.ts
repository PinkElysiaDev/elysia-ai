export interface PerceptionContext {
  stimulusId: string
  habitatId?: string
  actorId?: string
  type: string
  tokenCount: number
}

export interface PerceptionIntent {
  primary: string
  confidence: number
}

export interface PerceptionEntity {
  type: string
  value: string
  confidence: number
}

export interface PerceptionSentiment {
  label: 'positive' | 'negative' | 'neutral'
  confidence: number
}

export interface PerceptionResult {
  stimulusId: string
  context: PerceptionContext
  intent: PerceptionIntent
  entities: PerceptionEntity[]
  sentiment: PerceptionSentiment
  analyzedAt: number
  metadata?: Record<string, unknown>
}
