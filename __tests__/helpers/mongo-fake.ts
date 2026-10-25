/**
 * 共享的忠实 Mongo 集合 Fake 与通用 filter 求值器（测试基建，非测试文件）。
 *
 * 供 d1-mongo-persistence / phase43 / phase44 / trigger-repository /
 * d1-mongo-runtime-repositories 等契约测试复用：
 *   - matchesFilter：通用递归求值器，支持点路径相等、$ne/$in/$gte/$lte/$or/$elemMatch
 *     （Phase B-D 的查询下推会发出这些算子）
 *   - applyFindOptions：sort（点路径取值，1/-1 多键）/ limit / skip
 *   - FaithfulMongoCollection：find（含 options 与 findCalls/findOptions 记录）、
 *     countDocuments、findOne、updateOne（$set/$setOnInsert/$inc + upsert）、
 *     deleteOne、createIndex
 */

/** 读取对象的嵌套点路径值，如 getPath(doc, 'entry.lifeId')。 */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/** 设置对象的嵌套点路径值（用于 $inc / $set），按需创建中间对象。 */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cursor = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

/** Mongo 相等语义：null 与缺失（undefined）视为相等（{field: null} 命中缺失字段）。 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if ((a === null && b === undefined) || (a === undefined && b === null)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => valuesEqual(item, b[index]))
  }
  return false
}

/** 可比较时返回差值；类型不可比返回 NaN（任何比较均为 false）。 */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return Number.NaN
}

function isOperatorObject(condition: unknown): condition is Record<string, unknown> {
  return typeof condition === 'object'
    && condition !== null
    && !Array.isArray(condition)
    && Object.keys(condition).some((key) => key.startsWith('$'))
}

/** 单字段值的条件求值：字面量相等或算子对象（$ne/$in/$gte/... 逐一成立）。 */
function matchCondition(value: unknown, condition: unknown): boolean {
  if (isOperatorObject(condition)) {
    return Object.entries(condition).every(([operator, operand]) => matchOperator(value, operator, operand))
  }
  return valuesEqual(value, condition)
}

function matchOperator(value: unknown, operator: string, operand: unknown): boolean {
  switch (operator) {
    case '$eq':
      return valuesEqual(value, operand)
    case '$ne':
      return !valuesEqual(value, operand)
    case '$in':
      return Array.isArray(operand) && operand.some((candidate) => valuesEqual(value, candidate))
    case '$nin':
      return !(Array.isArray(operand) && operand.some((candidate) => valuesEqual(value, candidate)))
    case '$gt':
      return compareValues(value, operand) > 0
    case '$gte':
      return compareValues(value, operand) >= 0
    case '$lt':
      return compareValues(value, operand) < 0
    case '$lte':
      return compareValues(value, operand) <= 0
    case '$exists':
      return (value !== undefined) === Boolean(operand)
    case '$elemMatch':
      // 操作数是元素级子 filter（{field: value / 算子}），不是字面量
      return Array.isArray(value)
        && value.some((element) => matchesFilter(element, operand as Record<string, unknown>))
    default:
      throw new Error(`mongo-fake: unsupported operator ${operator}`)
  }
}

/**
 * 通用 Mongo filter 求值器：顶层键为点路径字段（或 $or/$and/$nor 逻辑算子），
 * 字段条件为字面量相等或 {$ne/$in/$gte/$lte/$elemMatch/...} 算子对象。
 */
export function matchesFilter(doc: unknown, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or' || key === '$and' || key === '$nor') {
      const subFilters = condition as Record<string, unknown>[]
      if (!Array.isArray(subFilters)) return false
      if (key === '$or') return subFilters.some((sub) => matchesFilter(doc, sub))
      if (key === '$and') return subFilters.every((sub) => matchesFilter(doc, sub))
      return !subFilters.some((sub) => matchesFilter(doc, sub))
    }
    return matchCondition(getPath(doc, key), condition)
  })
}

/** 排序比较：null/缺失最低（对齐 Mongo 缺失字段的排序位），其余按类型序。 */
function compareForSort(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined
  const bMissing = b === null || b === undefined
  if (aMissing && bMissing) return 0
  if (aMissing) return -1
  if (bMissing) return 1
  const compared = compareValues(a, b)
  return Number.isNaN(compared) ? 0 : compared
}

export interface MongoFakeFindOptions {
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
  projection?: Record<string, 0 | 1>
}

/** 对已按 filter 匹配的文档应用 find options：多键 sort（1/-1）→ skip → limit。 */
export function applyFindOptions<TDoc>(
  docs: TDoc[],
  options?: MongoFakeFindOptions,
): TDoc[] {
  let result = [...docs]
  if (options?.sort) {
    const keys = Object.entries(options.sort)
    result.sort((a, b) => {
      for (const [path, direction] of keys) {
        const compared = compareForSort(getPath(a, path), getPath(b, path)) * direction
        if (compared !== 0) return compared
      }
      return 0
    })
  }
  if (options?.skip !== undefined && options.skip > 0) result = result.slice(options.skip)
  if (options?.limit !== undefined && options.limit >= 0) result = result.slice(0, options.limit)
  return result
}

/**
 * 忠实 Mongo 集合 Fake：
 * - 文档 = { [modelKey]: 领域模型 }（无外层骨架），定位一律走 matchesFilter；
 * - find/findOne 经 matchesFilter 全量求值（嵌套点路径 + 算子）；
 * - find 支持 options（sort/limit/skip），记录 findCalls（filter）与 findOptions；
 * - countDocuments 按 filter 计数并记录 countCalls；
 * - updateOne 支持 $set/$setOnInsert/$inc + upsert；deleteOne 真正删除。
 */
export class FaithfulMongoCollection<TDoc> {
  readonly documents = new Map<string, TDoc>()
  readonly indexes: Array<{ keys: Record<string, 1 | -1>; options?: Record<string, unknown> }> = []
  findCalls: Array<Record<string, unknown>> = []
  findOptions: Array<MongoFakeFindOptions | undefined> = []
  findOneCalls: Array<Record<string, unknown>> = []
  countCalls: Array<Record<string, unknown>> = []
  private nextKey = 0

  /** 按完整 filter 定位首个命中文档的内部键（对齐真实 driver 的 filter 语义）。 */
  private findKey(filter: Record<string, unknown>): string | undefined {
    for (const [key, doc] of this.documents) {
      if (matchesFilter(doc, filter)) return key
    }
    return undefined
  }

  async findOne(filter: Record<string, unknown>): Promise<TDoc | null> {
    this.findOneCalls.push(filter)
    for (const doc of this.documents.values()) {
      if (matchesFilter(doc, filter)) return doc
    }
    return null
  }

  find(filter: Record<string, unknown>, options?: MongoFakeFindOptions): { toArray(): Promise<TDoc[]> } {
    this.findCalls.push(filter)
    this.findOptions.push(options)
    const matched = [...this.documents.values()].filter((doc) => matchesFilter(doc, filter))
    const applied = applyFindOptions(matched, options)
    return { toArray: async () => applied }
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    this.countCalls.push(filter)
    return [...this.documents.values()].filter((doc) => matchesFilter(doc, filter)).length
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    options: { upsert: boolean },
  ): Promise<unknown> {
    const key = this.findKey(filter)
    const existing = key !== undefined ? this.documents.get(key) : undefined
    if (key === undefined && !options.upsert) return { matchedCount: 0 }

    const base: Record<string, unknown> = existing
      ? structuredClone(existing)
      : { ...(update.$setOnInsert ?? {}) }

    for (const [k, value] of Object.entries(update.$set ?? {})) setPath(base, k, value)
    for (const [k, by] of Object.entries(update.$inc ?? {})) {
      const current = getPath(base, k)
      setPath(base, k, (typeof current === 'number' ? current : 0) + by)
    }

    if (key === undefined) {
      this.documents.set(`doc-${this.nextKey++}`, base as TDoc)
    } else {
      this.documents.set(key, base as TDoc)
    }
    return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 }
  }

  async deleteOne(filter: Record<string, unknown>): Promise<unknown> {
    const key = this.findKey(filter)
    const had = key !== undefined ? this.documents.delete(key) : false
    return { deletedCount: had ? 1 : 0 }
  }

  async createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown> {
    this.indexes.push({ keys, options })
    return options?.name ?? 'idx'
  }
}
