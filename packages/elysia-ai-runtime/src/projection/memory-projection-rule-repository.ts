import type { ProjectionRule, ProjectionRuleRepository } from '@elysia-ai/core'

export class MemoryProjectionRuleRepository implements ProjectionRuleRepository {
  private readonly rules = new Map<string, ProjectionRule>()

  async getById(id: string): Promise<ProjectionRule | null> {
    return this.rules.get(id) ?? null
  }

  async listByLifeId(lifeId: string): Promise<ProjectionRule[]> {
    return Array.from(this.rules.values()).filter((rule) => rule.lifeId === lifeId)
  }

  async listEnabled(): Promise<ProjectionRule[]> {
    return Array.from(this.rules.values()).filter((rule) => rule.enabled !== false)
  }

  async listAll(): Promise<ProjectionRule[]> {
    return Array.from(this.rules.values())
  }

  async save(rule: ProjectionRule): Promise<void> {
    this.rules.set(rule.id, rule)
  }

  async remove(id: string): Promise<void> {
    this.rules.delete(id)
  }

  clear(): void {
    this.rules.clear()
  }
}
