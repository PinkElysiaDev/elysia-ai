import type { Habitat } from '@elysia-ai/core'
import type { HabitatRegistry } from './habitat-registry.js'

export class MemoryHabitatRegistry implements HabitatRegistry {
  private habitats = new Map<string, Habitat>()

  register(habitat: Habitat): void {
    this.habitats.set(habitat.id, habitat)
  }

  getById(id: string): Habitat | undefined {
    return this.habitats.get(id)
  }

  getAll(): Habitat[] {
    return Array.from(this.habitats.values())
  }
}
