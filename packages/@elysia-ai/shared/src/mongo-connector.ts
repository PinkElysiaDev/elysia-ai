import type { MongoDocLikeCollection } from './mongo-doc-repository.js'

// ─────────────────────────────────────────────────
// Mongo 连接器（URL → collection）
//
// 设计原则（见 docs/elysia-ai-review-2026-06.md D1）：
//   - 项目**不内置/不嵌入** MongoDB；用户自部署，我们只用 mongodb URL 去连。
//   - `mongodb` 是**可选运行时依赖**：仅当配置了 mongo 才动态 import，未装也不影响内存模式。
//   - 复用 elysia-ai-runtime/store/runtime-state-repository.ts 已验证的
//     动态 import('mongodb') + 依赖注入 + connect/close 形态。
//
// 返回 MongoDocLikeCollection（memory/bond 仓储与 MongoDocRepository 共用的最小契约），
// 因此连出来的真实 collection 可直接喂给 MongoMemoryRepository / MongoBondRepository。
// ─────────────────────────────────────────────────

export interface MongoConnectionConfig {
  /** MongoDB 连接 URL，如 mongodb://localhost:27017。必填。 */
  uri: string
  /** 数据库名，默认 'elysia_ai'。 */
  database?: string
}

/** mongodb driver MongoClient 的最小结构契约（仅连接器所需）。 */
export interface MongoClientLike {
  connect(): Promise<unknown>
  close(): Promise<unknown>
  db(name: string): {
    collection<TDoc extends { id: string }>(name: string): MongoDocLikeCollection<TDoc>
  }
}

export interface MongoConnectorDependencies {
  /** 注入点：测试或自定义场景下替换真实 MongoClient 构造。 */
  createMongoClient?(uri: string): MongoClientLike
}

export interface MongoConnection {
  /** 取一个集合句柄（领域文档需含 id 字段）。 */
  collection<TDoc extends { id: string }>(name: string): MongoDocLikeCollection<TDoc>
  /** 关闭底层连接，释放资源。 */
  close(): Promise<void>
}

const DEFAULT_DATABASE = 'elysia_ai'

/** 动态加载 mongodb（可选依赖）；未安装时给出明确指引。 */
async function createDefaultMongoClient(uri: string): Promise<MongoClientLike> {
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ MongoClient: new (uri: string) => MongoClientLike }>

  let mongodb: { MongoClient: new (uri: string) => MongoClientLike }
  try {
    mongodb = await importer('mongodb')
  } catch (error) {
    throw new Error(
      'Mongo repository requires the optional "mongodb" package. '
      + 'Install it in your deployment (npm i mongodb) to use repository.type="mongo". '
      + `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return new mongodb.MongoClient(uri)
}

/**
 * 按 URL 连接外部 MongoDB，返回一个可取集合、可关闭的连接句柄。
 * 调用方负责在插件 dispose 时 close()。
 */
export async function connectMongo(
  config: MongoConnectionConfig,
  dependencies: MongoConnectorDependencies = {},
): Promise<MongoConnection> {
  if (!config.uri) {
    throw new Error('connectMongo requires a non-empty uri')
  }

  const client = dependencies.createMongoClient
    ? dependencies.createMongoClient(config.uri)
    : await createDefaultMongoClient(config.uri)

  await client.connect()
  const db = client.db(config.database ?? DEFAULT_DATABASE)

  return {
    collection<TDoc extends { id: string }>(name: string): MongoDocLikeCollection<TDoc> {
      return db.collection<TDoc>(name)
    },
    async close() {
      await client.close()
    },
  }
}

export interface LazyMongoCollection<TDoc extends { id: string }> {
  /** 首次访问任一方法时才建立连接的集合句柄。 */
  collection: MongoDocLikeCollection<TDoc>
  /** 若已建立连接则关闭；从未连接则为 no-op。 */
  close(): Promise<void>
}

/**
 * 惰性集合：把异步连接包成同步可得的 MongoDocLikeCollection，
 * 仅在首个仓储操作真正触达时才 connectMongo。
 *
 * 用途：Koishi `apply` 与仓储工厂均为同步，而连库是异步；惰性化使
 * memory/bond 插件能在同步路径上拿到集合句柄，连接推迟到首次读写。
 * 连接只建立一次（promise 缓存），dispose 时 close。
 */
export function lazyMongoCollection<TDoc extends { id: string }>(
  config: MongoConnectionConfig,
  collectionName: string,
  dependencies: MongoConnectorDependencies = {},
): LazyMongoCollection<TDoc> {
  let connectionPromise: Promise<MongoConnection> | undefined

  const connection = (): Promise<MongoConnection> => {
    if (!connectionPromise) connectionPromise = connectMongo(config, dependencies)
    return connectionPromise
  }

  const resolveCollection = async (): Promise<MongoDocLikeCollection<TDoc>> => {
    const conn = await connection()
    return conn.collection<TDoc>(collectionName)
  }

  const collection: MongoDocLikeCollection<TDoc> = {
    async findOne(filter) {
      return (await resolveCollection()).findOne(filter)
    },
    find(filter) {
      // find 同步返回；包成 toArray 惰性求值的游标，保留 MongoCursorLike 形态。
      return {
        async toArray() {
          const col = await resolveCollection()
          const cursor = col.find(filter)
          if (Array.isArray(cursor)) return cursor
          return 'toArray' in cursor ? cursor.toArray() : cursor
        },
      }
    },
    async updateOne(filter, update, options) {
      return (await resolveCollection()).updateOne(filter, update, options)
    },
    async deleteOne(filter) {
      const col = await resolveCollection()
      return col.deleteOne?.(filter)
    },
    async createIndex(keys, options) {
      const col = await resolveCollection()
      return col.createIndex?.(keys, options)
    },
  }

  return {
    collection,
    async close() {
      if (!connectionPromise) return
      const conn = await connectionPromise
      await conn.close()
    },
  }
}
