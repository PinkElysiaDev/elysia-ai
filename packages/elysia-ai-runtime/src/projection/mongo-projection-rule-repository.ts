import type { ProjectionRule, ProjectionRuleRepository } from '@elysia-ai/core'
import { MongoDocRepository, type MongoDocLikeCollection } from '@elysia-ai/shared'

// ─────────────────────────────────────────────────
// Mongo ProjectionRule 仓储（裸 driver，组合 MongoDocRepository）
//
// 文档形态：{ id, rule: ProjectionRule, createdAt, updatedAt }，与 memory/bond 一致。
// ProjectionRule 由配置派生、数量小，listEnabled/listAll 非 lifeId 维度，故用
// findMany({}) 取全集合后在内存筛选——对小集合可接受，无并发计数热点。
// ─────────────────────────────────────────────────

export interface MongoProjectionRuleDocument {
  id: string
  rule: ProjectionRule
  createdAt: number
  updatedAt: number
}

export interface MongoProjectionRuleRepositoryOptions {
  collectionName?: string
  ensureIndexes?: boolean
}

function cloneRule(rule: ProjectionRule): ProjectionRule {
  return {
    ...rule,
    metadata: rule.metadata ? { ...rule.metadata } : undefined,
  }
}

export class MongoProjectionRuleRepository implements ProjectionRuleRepository {
  private readonly gateway: MongoDocRepository<ProjectionRule, MongoProjectionRuleDocument>

  constructor(
    collection: MongoDocLikeCollection<MongoProjectionRuleDocument>,
    options: MongoProjectionRuleRepositoryOptions = {},
  ) {
    const name = options.collectionName ?? 'elysia_projection_rules'
    this.gateway = new MongoDocRepository<ProjectionRule, MongoProjectionRuleDocument>(collection, {
      modelKey: 'rule',
      toModel: (doc) => doc.rule,
      cloneModel: cloneRule,
      indexes: options.ensureIndexes === false ? [] : [
        { keys: { id: 1 }, options: { unique: true, name: `${name}_id_unique` } },
        { keys: { 'rule.lifeId': 1 }, options: { name: `${name}_life` } },
        { keys: { 'rule.enabled': 1 }, options: { name: `${name}_enabled` } },
      ],
    })
  }

  async ensureIndexes(): Promise<void> {
    await this.gateway.ensureIndexes()
  }

  async getById(id: string): Promise<ProjectionRule | null> {
    return (await this.gateway.findById(id)) ?? null
  }

  async listByLifeId(lifeId: string): Promise<ProjectionRule[]> {
    return this.gateway.findMany({ 'rule.lifeId': lifeId })
  }

  async listEnabled(): Promise<ProjectionRule[]> {
    // enabled !== false（含 undefined 视为启用），故全量取后在内存筛选。
    const rules = await this.gateway.findMany({})
    return rules.filter((rule) => rule.enabled !== false)
  }

  async listAll(): Promise<ProjectionRule[]> {
    return this.gateway.findMany({})
  }

  async save(rule: ProjectionRule): Promise<void> {
    await this.gateway.upsert(rule.id, rule)
  }

  async remove(id: string): Promise<void> {
    await this.gateway.deleteById(id)
  }
}
