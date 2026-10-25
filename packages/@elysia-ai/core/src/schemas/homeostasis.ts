import { z } from 'zod'

export const homeostasisStateSchema = z.object({
  timestamp: z.number(),
  energy: z.number(),
  mood: z.number(),
  sociability: z.number(),
  curiosity: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const homeostasisDeltaSchema = z.object({
  energy: z.number(),
  mood: z.number(),
  sociability: z.number(),
  curiosity: z.number(),
  reason: z.string(),
})
