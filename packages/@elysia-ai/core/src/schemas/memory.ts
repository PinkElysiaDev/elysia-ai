import { z } from 'zod'

export const memoryKindSchema = z.enum([
  'episodic',
  'semantic',
  'preference',
  'relationship',
  'self',
  'task',
  'system',
])

export const memoryScopeSchema = z.enum([
  'life',
  'actor',
  'habitat',
  'thread',
  'projection',
  'global',
])

export const memoryStatusSchema = z.enum([
  'active',
  'archived',
  'suppressed',
  'deleted',
])

export const memoryOwnerTypeSchema = z.enum([
  'life',
  'actor',
  'habitat',
  'thread',
  'projection',
  'event',
  'global',
])

export const memoryVisibilitySchema = z.enum([
  'private',
  'shared',
  'habitat',
  'global',
])

export const memoryRelationRoleSchema = z.enum([
  'subject',
  'participant',
  'mentioned',
  'observer',
  'location',
  'source',
  'shared-with',
])

export const memoryRelationSchema = z.object({
  targetType: memoryOwnerTypeSchema,
  targetId: z.string(),
  role: memoryRelationRoleSchema,
  confidence: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const memorySourceSchema = z.object({
  stimulusId: z.string().optional(),
  behaviorPlanId: z.string().optional(),
  executionPlanId: z.string().optional(),
  executionActionId: z.string().optional(),
  dialogueTaskId: z.string().optional(),
  outputId: z.string().optional(),
  event: z.string().optional(),
  createdBy: z.string().optional(),
})

export const memoryEntrySchema = z.object({
  id: z.string(),
  lifeId: z.string(),
  scope: memoryScopeSchema,
  kind: memoryKindSchema,
  status: memoryStatusSchema,
  content: z.string(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  actorId: z.string().optional(),
  habitatId: z.string().optional(),
  threadId: z.string().optional(),
  projectionId: z.string().optional(),
  ownerType: memoryOwnerTypeSchema.optional(),
  ownerId: z.string().optional(),
  relations: z.array(memoryRelationSchema).optional(),
  visibility: memoryVisibilitySchema.optional(),
  eventId: z.string().optional(),
  eventType: z.string().optional(),
  source: memorySourceSchema.optional(),
  importance: z.number(),
  confidence: z.number(),
  decay: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessedAt: z.number().optional(),
  accessCount: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
