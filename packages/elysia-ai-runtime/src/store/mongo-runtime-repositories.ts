import type { MongoConnection } from '@elysia-ai/shared'
import {
  MongoProjectionRuleRepository,
  type MongoProjectionRuleDocument,
} from '../projection/mongo-projection-rule-repository.js'

/**
 * mongo 模式下 runtime 使用的 Mongo 仓储集合（P0-3）。
 *
 * 投影规则与 homeostasis 状态共用同一条 Mongo 连接，但各占独立集合，互不干扰。
 * （followup 调度任务集合已随 SchedulerService 退役移除。）
 */
export const MONGO_PROJECTION_RULES_COLLECTION = 'elysia_projection_rules'

export interface MongoRuntimeRepositories {
  projectionRuleRepository: MongoProjectionRuleRepository
  /** 建索引失败不应阻断 runtime 启动，由调用方决定是否仅记录日志。 */
  ensureIndexes(): Promise<void>
}

export function createMongoRuntimeRepositories(
  connection: MongoConnection,
): MongoRuntimeRepositories {
  const projectionRuleRepository = new MongoProjectionRuleRepository(
    connection.collection<MongoProjectionRuleDocument>(MONGO_PROJECTION_RULES_COLLECTION),
  )

  return {
    projectionRuleRepository,
    async ensureIndexes(): Promise<void> {
      await projectionRuleRepository.ensureIndexes()
    },
  }
}
