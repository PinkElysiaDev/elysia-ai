// ─────────────────────────────────────────────────
// Mongo 文档仓储基类（裸 mongodb driver 形态）
//
// 收敛 memory / bond / state 三个 Mongo 仓储中重复的集合管线：
//   - find({}) 游标归一化（数组 / toArray / Promise 三种返回形态）
//   - $set + $setOnInsert 的 upsert 写入
//   - findOne(by id) → 取出并克隆领域模型
//   - createIndex 批量建索引
//
// 设计为**组合**而非继承：现有 Mongo*Repository 仍各自承载 hydrate-to-memory 行为，
// 仅把集合层调用委托给本基类，从而 0 行为变更。
//
// 【D1 接缝】loadAll() 是当前的全表 hydrate；query() 钩子预留给 D1 填入服务端
// filter/sort/limit 直查，以彻底取代全表加载。详见 docs 评审计划 D1-1。
// ─────────────────────────────────────────────────

export interface MongoCursorLike<TDoc> {
  toArray(): Promise<TDoc[]>
}

/** 裸 mongodb driver collection 的结构化最小契约（仅本基类所需的方法）。 */
export interface MongoDocLikeCollection<TDoc> {
  findOne(filter: Record<string, unknown>): Promise<TDoc | null>
  find(filter: Record<string, unknown>): MongoCursorLike<TDoc> | Promise<TDoc[]> | TDoc[]
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

export interface MongoIndexSpec {
  keys: Record<string, 1 | -1>
  options?: Record<string, unknown>
}

export interface MongoDocRepositoryConfig<TModel, TDoc> {
  /** 文档中承载领域模型的字段名，如 'entry' / 'bond'。 */
  modelKey: string
  /** 从文档取出领域模型。 */
  toModel(doc: TDoc): TModel
  /** 深拷贝领域模型：读写均克隆，避免外部句柄泄漏。 */
  cloneModel(model: TModel): TModel
  /** 启动时建立的索引规格。 */
  indexes?: MongoIndexSpec[]
}

export class MongoDocRepository<TModel, TDoc extends { id: string }> {
  constructor(
    private readonly collection: MongoDocLikeCollection<TDoc>,
    private readonly config: MongoDocRepositoryConfig<TModel, TDoc>,
  ) {}

  async ensureIndexes(): Promise<void> {
    for (const spec of this.config.indexes ?? []) {
      await this.collection.createIndex?.(spec.keys, spec.options)
    }
  }

  async findById(id: string): Promise<TModel | undefined> {
    const doc = await this.collection.findOne({ id })
    return doc ? this.config.cloneModel(this.config.toModel(doc)) : undefined
  }

  /**
   * 全表加载（hydrate）。归一化 driver 的三种 find 返回形态。
   * 【D1】保留用于全集合维护场景；查询热路径已改用 findMany(filter) 做服务端缩小集合。
   */
  async loadAll(): Promise<TModel[]> {
    return this.findMany({})
  }

  /**
   * 【D1-1】按 Mongo filter 服务端直查，取代全表 loadAll。
   * 归一化 driver 的三种 find 返回形态（数组 / 游标 toArray / Promise）。
   * 传入与既有复合索引对齐的高选择性 filter（如 { 'entry.lifeId': id }），
   * 即可把"加载整个集合"收窄为"只加载相关子集"，其余精细过滤交由调用方在子集上完成，
   * 从而既消除全表加载、又零语义偏移。
   */
  async findMany(filter: Record<string, unknown>): Promise<TModel[]> {
    const cursor = this.collection.find(filter)
    const documents = Array.isArray(cursor)
      ? cursor
      : 'toArray' in cursor
        ? await cursor.toArray()
        : await cursor
    return documents.map((doc) => this.config.cloneModel(this.config.toModel(doc)))
  }

  /**
   * 【D1-2】原子自增字段，取代应用层的读-改-写。
   * 使用 Mongo `$inc` 在服务端原子完成计数，避免并发下的更新丢失。
   * 同时以 `$set` 落 updatedAt 与可选的伴随字段（如 lastAccessedAt）。
   */
  async increment(
    id: string,
    field: string,
    by = 1,
    setFields: Record<string, unknown> = {},
  ): Promise<void> {
    await this.collection.updateOne(
      { id },
      {
        $inc: { [`${this.config.modelKey}.${field}`]: by },
        $set: { ...this.prefixModelFields(setFields), updatedAt: Date.now() },
      },
      { upsert: false },
    )
  }

  private prefixModelFields(fields: Record<string, unknown>): Record<string, unknown> {
    const prefixed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(fields)) {
      prefixed[`${this.config.modelKey}.${key}`] = value
    }
    return prefixed
  }

  async upsert(id: string, model: TModel): Promise<void> {
    const now = Date.now()
    await this.collection.updateOne(
      { id },
      {
        $set: { [this.config.modelKey]: this.config.cloneModel(model), updatedAt: now },
        $setOnInsert: { id, createdAt: now },
      },
      { upsert: true },
    )
  }

  async deleteById(id: string): Promise<void> {
    await this.collection.deleteOne?.({ id })
  }
}
