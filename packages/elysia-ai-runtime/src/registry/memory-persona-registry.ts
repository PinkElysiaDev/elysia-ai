import type { Persona, PersonaRegistry } from '@elysia-ai/core'

export class MemoryPersonaRegistry implements PersonaRegistry {
  private readonly personas = new Map<string, Persona>()

  register(persona: Persona): void {
    this.personas.set(persona.lifeId, persona)
  }

  getByLifeId(lifeId: string): Persona | undefined {
    return this.personas.get(lifeId)
  }

  getAll(): Persona[] {
    return Array.from(this.personas.values())
  }
}
