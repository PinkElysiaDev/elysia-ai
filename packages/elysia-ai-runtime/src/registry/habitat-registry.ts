
import type { Habitat } from '@elysia-ai/core'

export interface HabitatRegistry {
  register(habitat: Habitat): void
  getById(id: string): Habitat | undefined
  getAll(): Habitat[]
}
