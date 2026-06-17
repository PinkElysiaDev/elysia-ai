import type { LifeInstance } from '@elysia-ai/core'
import type { LifeRegistry } from './life-registry.js'

export class MemoryLifeRegistry implements LifeRegistry {
  private lives = new Map<string, LifeInstance>()

  register(life: LifeInstance): void {
    this.lives.set(life.id, life)
  }

  getById(id: string): LifeInstance | undefined {
    return this.lives.get(id)
  }

  getAll(): LifeInstance[] {
    return Array.from(this.lives.values())
  }
}
