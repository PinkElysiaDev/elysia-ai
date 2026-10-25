/**
 * 持久化模式：runtime 统一决定，其他插件通过 elysia.persistence 服务获取。
 * - memory：内存仓储，重启即丢
 * - mongo：MongoDB 持久化仓储
 */
export type PersistenceMode = 'memory' | 'mongo'

/**
 * MongoDB 集合的最小结构契约（与 @elysia-ai/shared 的 MongoDocLikeCollection 对齐，
 * 但 core 不依赖 shared，故在此独立声明同构接口）。
 */
/** 服务端查询下推选项（与 shared 的 MongoFindOptions 同构镜像）。 */
export interface PersistenceFindOptions {
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
  projection?: Record<string, 0 | 1>
}

export interface PersistenceCollectionLike<TDoc> {
  findOne(filter: Record<string, unknown>): Promise<TDoc | null>
  find(
    filter: Record<string, unknown>,
    options?: PersistenceFindOptions,
  ): { toArray(): Promise<TDoc[]> } | Promise<TDoc[]> | TDoc[]
  countDocuments?(filter: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    options: { upsert: boolean },
  ): Promise<unknown>
  deleteOne?(filter: Record<string, unknown>): Promise<unknown>
  createIndex?(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown>
}

/**
 * 持久化服务：由 runtime 注册为 elysia.persistence，向其他插件公开持久化方式。
 *
 * 设计意图：持久化方式由 runtime 统一决定（stateRepository 配置），
 * 但 runtime 不把内部 config 直接交给其他插件，而是通过此服务公开：
 * - mode 告知当前持久化模式
 * - getCollection 返回 mongo 集合句柄（memory 模式或服务未注册时返回 undefined）
 *
 * 消费方（memory/bond 等）根据 mode 与 getCollection 自行选择仓储实现，
 * mongo 模式拿到句柄则建 mongo 仓储，否则回退内存仓储。
 */
export interface PersistenceService {
  readonly mode: PersistenceMode
  getCollection<TDoc>(name: string): PersistenceCollectionLike<TDoc> | undefined
}
