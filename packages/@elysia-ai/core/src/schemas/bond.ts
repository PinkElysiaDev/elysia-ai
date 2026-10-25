import { z } from 'zod'

export const bondTargetTypeSchema = z.enum([
  'actor',
  'life',
  'habitat',
  'thread',
  'projection',
  'external',
])

export const bondStatusSchema = z.enum([
  'active',
  'archived',
  'blocked',
  'deleted',
])

export const bondMetricsSchema = z.object({
  familiarity: z.number(),
  intimacy: z.number(),
  trust: z.number(),
  tension: z.number(),
  dependence: z.number(),
})

export const bondSourceSchema = z.object({
  stimulusId: z.string().optional(),
  memoryId: z.string().optional(),
  behaviorPlanId: z.string().optional(),
  executionPlanId: z.string().optional(),
  executionActionId: z.string().optional(),
  event: z.string().optional(),
  updatedBy: z.string().optional(),
})

export const bondSchema = z.object({
  id: z.string(),
  lifeId: z.string(),
  targetId: z.string(),
  targetType: bondTargetTypeSchema,
  status: bondStatusSchema,
  metrics: bondMetricsSchema,
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  actorId: z.string().optional(),
  habitatId: z.string().optional(),
  threadId: z.string().optional(),
  projectionId: z.string().optional(),
  source: bondSourceSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastInteractionAt: z.number().optional(),
  interactionCount: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
