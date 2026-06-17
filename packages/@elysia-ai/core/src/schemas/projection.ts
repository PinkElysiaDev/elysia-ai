import { z } from 'zod'

export const projectionStatusSchema = z.enum([
  'inactive',
  'active',
  'archived',
])

export const projectionSchema = z.object({
  id: z.string(),
  lifeId: z.string(),
  habitatId: z.string(),
  bodyId: z.string().optional(),
  botId: z.string().optional(),
  platform: z.string().optional(),
  status: projectionStatusSchema,
  priority: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const projectionRuleSchema = z.object({
  id: z.string(),
  lifeId: z.string(),
  enabled: z.boolean().optional(),
  priority: z.number(),
  habitatId: z.string().optional(),
  channelId: z.string().optional(),
  threadId: z.string().optional(),
  actorId: z.string().optional(),
  platform: z.string().optional(),
  botId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const projectionRoutingResultSchema = z.object({
  stimulusId: z.string(),
  habitatId: z.string(),
  lifeIds: z.array(z.string()),
  projectionIds: z.array(z.string()),
  routedAt: z.number(),
  reason: z.string(),
  matchedRules: z.array(projectionRuleSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
