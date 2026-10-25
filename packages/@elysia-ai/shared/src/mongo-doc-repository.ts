// ─────────────────────────────────────────────────
// Mongo 文档仓储基类（裸 mongodb driver 形态）
//
// 文档形态约定：{ [modelKey]: 领域模型 }——领域对象整体嵌入，无外层骨架
// （文档键/唯一索引走 `${modelKey}.id` 点路径；时间戳由领域对象自带）。
//
// 收敛 memory / bond 等 Mongo 仓储中重复的集合管线：
//   - find({}) 游标归一化（数组 / toArray / Promise 三种返回形态）
//   - $set 整体替换信封的 upsert 写入
//   - findOne(by `${modelKey}.id`) → 取出并克隆领域模型
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

/** 服务端查询下推选项（D1：driver 原生能力，契约此前未暴露）。 */
export interface MongoFindOptions {
  /** 键 → 1 升序 / -1 降序 */
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
  /** 键投影（当前无消费方，预留） */
  projection?: Record<string, 0 | 1>
}

/** 裸 mongodb driver collection 的结构化最小契约（仅本基类所需的方法）。 */
export interface MongoDocLikeCollection<TDoc> {
  findOne(filter: Record<string, unknown>): Promise<TDoc | null>
  find(filter: Record<string, unknown>, options?: MongoFindOptions): MongoCursorLike<TDoc> | Promise<TDoc[]> | TDoc[]
  /** 服务端计数（可选：fake/内存驱动可缺省，count() 回退 findMany） */
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

export class MongoDocRepository<TModel, TDoc> {
  constructor(
    private readonly collection: MongoDocLikeCollection<TDoc>,
    private readonly config: MongoDocRepositoryConfig<TModel, TDoc>,
  ) {}

  /** 文档键：领域模型自身 id 的点路径（如 'entry.id'）。 */
  private idFilter(id: string): Record<string, unknown> {
    return { [`${this.config.modelKey}.id`]: id }
  }

  async ensureIndexes(): Promise<void> {
    for (const spec of this.config.indexes ?? []) {
      await this.collection.createIndex?.(spec.keys, spec.options)
    }
  }

  async findById(id: string): Promise<TModel | undefined> {
    const doc = await this.collection.findOne(this.idFilter(id))
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
  async findMany(filter: Record<string, unknown>, options?: MongoFindOptions): Promise<TModel[]> {
    const cursor = this.collection.find(filter, options)
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
   * 可选的伴随字段（如 lastAccessedAt）以 `$set` 写入信封内。
   */
  async increment(
    id: string,
    field: string,
    by = 1,
    setFields: Record<string, unknown> = {},
  ): Promise<void> {
    await this.collection.updateOne(
      this.idFilter(id),
      {
        $inc: { [`${this.config.modelKey}.${field}`]: by },
        $set: this.prefixModelFields(setFields),
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

  /** 整体替换信封的 upsert：插入即随信封落库，无外层骨架字段。 */
  async upsert(id: string, model: TModel): Promise<void> {
    await this.collection.updateOne(
      this.idFilter(id),
      {
        $set: { [this.config.modelKey]: this.config.cloneModel(model) },
      },
      { upsert: true },
    )
  }

  /** 服务端计数；驱动不支持 countDocuments 时回退拉取计数。 */
  async count(filter: Record<string, unknown>): Promise<number> {
    if (typeof this.collection.countDocuments === 'function') {
      return this.collection.countDocuments(filter)
    }
    return (await this.findMany(filter)).length
  }

  async deleteById(id: string): Promise<void> {
    await this.collection.deleteOne?.(this.idFilter(id))
  }

  /**
   * 任意 filter 的原子条件更新（compare-and-swap 通道）：命中才应用 $set。
   * 返回是否命中——底层 driver updateOne 结果含 matchedCount，此处结构化
   * 归一（兼容 mock/内存驱动只返回 truthy 的形态）。
   */
  async conditionalUpdate(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown>, $setOnInsert?: Record<string, unknown> },
  ): Promise<boolean> {
    const result = await this.collection.updateOne(filter, { ...update }, { upsert: false })
    if (result && typeof result === 'object') {
      const matched = (result as { matchedCount?: unknown }).matchedCount
      if (typeof matched === 'number') return matched > 0
      if (typeof matched === 'boolean') return matched
    }
    return Boolean(result)
  }
}
