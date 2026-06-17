import { z } from 'zod'

export const dialogueRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

export const dialogueMessageSchema = z.object({
  role: dialogueRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const dialogueModeSchema = z.enum([
  'reply-now',
  'defer',
  'silent-update',
  'internal-update-only',
])

export const dialogueScopeSchema = z.object({
  type: z.enum(['user', 'thread', 'habitat', 'life-global']),
  key: z.string(),
})

export const dialogueTaskSchema = z.object({
  lifeId: z.string().optional(),
  habitatId: z.string().optional(),
  scope: dialogueScopeSchema,
  sourceStimulusIds: z.array(z.string()),
  mode: dialogueModeSchema,
  messages: z.array(dialogueMessageSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const dialogueResultSchema = z.object({
  taskId: z.string().optional(),
  output: z.string(),
  messages: z.array(dialogueMessageSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
