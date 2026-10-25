import type { ProjectionRule, ProjectionRuleRepository } from '@elysia-ai/core'
import { MongoDocRepository, type MongoDocLikeCollection } from '@elysia-ai/shared'

// ─────────────────────────────────────────────────
// Mongo ProjectionRule 仓储（裸 driver，组合 MongoDocRepository）
//
// 文档形态：{ rule: ProjectionRule }（领域对象整体嵌入，文档键/唯一索引走
// rule.id，无外层骨架；规则是配置性数据，不携带时间戳）。
// ProjectionRule 由配置派生、数量小，listEnabled/listAll 非 lifeId 维度，故用
// findMany({}) 取全集合后在内存筛选——对小集合可接受，无并发计数热点。
// ─────────────────────────────────────────────────

export interface MongoProjectionRuleDocument {
  rule: ProjectionRule
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
        { keys: { 'rule.id': 1 }, options: { unique: true, name: `${name}_id_unique` } },
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
    // 【D】enabled !== false（含 undefined/缺失视为启用）直接以 $ne 下推：
    // Mongo 的 $ne 对缺失字段同样命中，与原内存筛选语义一致，无需全量拉取。
    return this.gateway.findMany({ 'rule.enabled': { $ne: false } })
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
