
import type { LifeInstance } from '@elysia-ai/core'

export interface LifeRegistry {
  register(life: LifeInstance): void
  getById(id: string): LifeInstance | undefined
  getAll(): LifeInstance[]
}
