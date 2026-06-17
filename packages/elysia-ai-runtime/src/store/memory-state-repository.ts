import type { LifeStateRepository } from '@elysia-ai/core'

export class MemoryStateRepository<TState = Record<string, unknown>> implements LifeStateRepository<TState> {
  private readonly store = new Map<string, TState>()

  async getByLifeInstanceId(lifeInstanceId: string): Promise<TState | null> {
    return this.store.get(lifeInstanceId) ?? null
  }

  async save(lifeInstanceId: string, state: TState): Promise<void> {
    this.store.set(lifeInstanceId, state)
  }

  /** Returns all stored state entries for diagnostics */
  getAll(): Map<string, TState> {
    return this.store
  }

  /** Clears all stored state (for testing / reset) */
  clear(): void {
    this.store.clear()
  }
}
