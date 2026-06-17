import { z } from 'zod'

export const behaviorScopeTypeSchema = z.enum(['user', 'thread', 'habitat', 'life-global'])

export const behaviorScopeSchema = z.object({
  type: behaviorScopeTypeSchema,
  key: z.string(),
})

export const behaviorSignalSchema = z.object({
  directness: z.number(),
  continuity: z.number(),
  bondAffinity: z.number(),
  bufferPressure: z.number(),
  responseNecessity: z.number(),
  structuralDeterminability: z.number(),
})

export const behaviorActionTypeSchema = z.enum([
  'discard',
  'observe',
  'reply',
  'ask',
  'quote',
  'defer',
  'memory-only',
  'state-update',
  'proactive-topic',
])

export const behaviorPlannerSourceSchema = z.enum(['program', 'ai', 'hybrid'])

export const behaviorCandidateSchema = z.object({
  id: z.string(),
  type: behaviorActionTypeSchema,
  scope: behaviorScopeSchema,
  sourceStimulusIds: z.array(z.string()),
  priority: z.number(),
  confidence: z.number(),
  reason: z.string(),
  shouldEnterDialogue: z.boolean(),
  shouldUpdateMemory: z.boolean(),
  shouldUpdateBond: z.boolean(),
  shouldUpdateHomeostasis: z.boolean(),
  shouldScheduleFollowup: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const behaviorDecisionSchema = z.object({
  id: z.string(),
  selected: behaviorCandidateSchema,
  candidates: z.array(behaviorCandidateSchema),
  signal: behaviorSignalSchema,
  plannerSource: behaviorPlannerSourceSchema,
  decidedAt: z.number(),
  reason: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
