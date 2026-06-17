import type { ProjectionRule } from '@elysia-ai/core'

export interface ProjectionRegistry {
  register(rule: ProjectionRule): void
  getById(ruleId: string): ProjectionRule | undefined
  remove(ruleId: string): void
  list(): ProjectionRule[]
  listEnabled(): ProjectionRule[]
  listByLifeId(lifeId: string): ProjectionRule[]
  clear(): void
}

export class MemoryProjectionRegistry implements ProjectionRegistry {
  private rules = new Map<string, ProjectionRule>()

  register(rule: ProjectionRule): void {
    this.rules.set(rule.id, rule)
  }

  getById(ruleId: string): ProjectionRule | undefined {
    return this.rules.get(ruleId)
  }

  remove(ruleId: string): void {
    this.rules.delete(ruleId)
  }

  list(): ProjectionRule[] {
    return Array.from(this.rules.values())
  }

  listEnabled(): ProjectionRule[] {
    return this.list().filter((rule) => rule.enabled !== false)
  }

  listByLifeId(lifeId: string): ProjectionRule[] {
    return this.list().filter((rule) => rule.lifeId === lifeId)
  }

  clear(): void {
    this.rules.clear()
  }
}
