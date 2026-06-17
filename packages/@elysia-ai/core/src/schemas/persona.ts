import { z } from 'zod'

export const personaSchema = z.object({
  lifeId: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  traits: z.array(z.string()).optional(),
  tone: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
