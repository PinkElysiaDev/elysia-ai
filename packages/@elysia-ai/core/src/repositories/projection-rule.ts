import type { ProjectionRule } from '../types/projection.js'

export interface ProjectionRuleRepository {
  getById(id: string): Promise<ProjectionRule | null>
  listByLifeId(lifeId: string): Promise<ProjectionRule[]>
  listEnabled(): Promise<ProjectionRule[]>
  listAll(): Promise<ProjectionRule[]>
  save(rule: ProjectionRule): Promise<void>
  remove(id: string): Promise<void>
}
