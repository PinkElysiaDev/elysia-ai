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
    collection<TDoc>(name: string): MongoDocLikeCollection<TDoc>
  }
}

export interface MongoConnectorDependencies {
  /** 注入点：测试或自定义场景下替换真实 MongoClient 构造。 */
  createMongoClient?(uri: string): MongoClientLike
}

export interface MongoConnection {
  /** 取一个集合句柄（文档形态由调用方的仓储约定决定）。 */
  collection<TDoc>(name: string): MongoDocLikeCollection<TDoc>
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
    collection<TDoc>(name: string): MongoDocLikeCollection<TDoc> {
      return db.collection<TDoc>(name)
    },
    async close() {
      await client.close()
    },
  }
}
