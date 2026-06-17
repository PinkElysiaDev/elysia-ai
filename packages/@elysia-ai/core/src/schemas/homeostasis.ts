import { z } from 'zod'

export const homeostasisStateSchema = z.object({
  lifeInstanceId: z.string(),
  timestamp: z.number(),
  energy: z.number(),
  mood: z.number(),
  sociability: z.number(),
  curiosity: z.number(),
  responseThreshold: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const homeostasisDeltaSchema = z.object({
  lifeInstanceId: z.string(),
  energy: z.number(),
  mood: z.number(),
  sociability: z.number(),
  curiosity: z.number(),
  responseThreshold: z.number(),
  reason: z.string(),
})
