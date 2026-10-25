/**
 * 定时触发器任务的 Mongo 仓储（Mode B：连接由 runtime 的 elysia.persistence
 * 统一管理，本仓储只持有集合句柄；memory 模式或连接失败时由选择链回退内存版）。
 *
 * 文档形态：{ task: TriggerTask }（领域对象整体嵌入，文档键/唯一索引走 task.id，
 * 时间戳由 task 自带，无外层骨架）。
 * 索引与收割查询路径对齐（enabled + status + nextRunAt 复合）。
 */

import type {
  CoreEventMap,
  EventBus,
  PersistenceCollectionLike,
  PersistenceService,
  TriggerTask,
  TriggerTaskRepository,
} from '@elysia-ai/core'
import { MongoDocRepository } from '@elysia-ai/shared'
import type { MongoIndexSpec } from '@elysia-ai/shared'

export interface MongoTriggerTaskDocument {
  task: TriggerTask
}

export const MONGO_TRIGGER_TASKS_COLLECTION = 'elysia_trigger_tasks'

/** 深浅混合克隆：顶层展开 + condition/state 单层克隆（防句柄泄漏）。 */
function cloneTask(task: TriggerTask): TriggerTask {
  return {
    ...task,
    condition: { ...task.condition } as TriggerTask['condition'],
    state: { ...task.state },
  }
}

export interface MongoTriggerTaskRepositoryOptions {
  /** 索引命名用集合名（默认 elysia_trigger_tasks） */
  collectionName?: string
  /** false 时不建索引（默认建） */
  ensureIndexes?: boolean
  /** 失败事件发射通道（repository.query/write.failed）；缺省只抛错不发事件 */
  eventBus?: EventBus<CoreEventMap>
}

export class MongoTriggerTaskRepository implements TriggerTaskRepository {
  private readonly gateway: MongoDocRepository<TriggerTask, MongoTriggerTaskDocument>
  private readonly collectionName: string
  private readonly eventBus?: EventBus<CoreEventMap>

  constructor(
    collection: PersistenceCollectionLike<MongoTriggerTaskDocument>,
    options: MongoTriggerTaskRepositoryOptions = {},
  ) {
    const name = options.collectionName ?? MONGO_TRIGGER_TASKS_COLLECTION
    this.collectionName = name
    this.eventBus = options.eventBus
    const indexes: MongoIndexSpec[] = options.ensureIndexes === false ? [] : [
      { keys: { 'task.id': 1 }, options: { unique: true, name: `${name}_id_unique` } },
      { keys: { 'task.habitatId': 1 }, options: { name: `${name}_habitat` } },
      { keys: { 'task.ownerKey': 1 }, options: { name: `${name}_owner` } },
      {
        keys: { 'task.enabled': 1, 'task.state.status': 1, 'task.state.nextRunAt': 1 },
        options: { name: `${name}_harvest` },
      },
    ]
    this.gateway = new MongoDocRepository<TriggerTask, MongoTriggerTaskDocument>(collection, {
      modelKey: 'task',
      toModel: (doc) => doc.task,
      cloneModel: cloneTask,
      indexes,
    })
  }

  /** CRUD 失败时发射 repository 诊断事件（observatory 可见）；错误照常上抛由调用方处理。 */
  private reportFailure(kind: 'query' | 'write', operation: string, error: unknown): void {
    if (!this.eventBus) return
    void this.eventBus.emit(kind === 'query' ? 'repository.query.failed' : 'repository.write.failed', {
      component: 'trigger-task',
      repositoryType: 'mongo',
      operation,
      error,
      metadata: {
        plugin: 'elysia-ai-behavior',
        collection: this.collectionName,
      },
    })
  }

  ensureIndexes(): Promise<void> {
    return this.gateway.ensureIndexes()
  }

  async save(task: TriggerTask): Promise<void> {
    try {
      await this.gateway.upsert(task.id, task)
    } catch (error) {
      this.reportFailure('write', 'save', error)
      throw error
    }
  }

  async claim(taskId: string, expectedOccurrenceKey: string, now: number): Promise<boolean> {
    try {
      // Mongo 单文档原子 CAS：两个进程同时认领同一轮，仅一个 updateOne 命中
      return await this.gateway.conditionalUpdate(
        {
          'task.id': taskId,
          'task.state.status': 'waiting',
          'task.state.occurrenceKey': expectedOccurrenceKey,
        },
        {
          $set: {
            'task.state.status': 'running',
            'task.state.lastRunAt': now,
          },
        },
      )
    } catch (error) {
      this.reportFailure('write', 'claim', error)
      throw error
    }
  }

  async markClaimConflict(taskId: string): Promise<void> {
    try {
      // 仅当任务确已被认领（running）时附写提示；waiting/paused 态说明
      // 认领失败另有原因（删除/暂停竞态），不写任何东西避免污染
      await this.gateway.conditionalUpdate(
        { 'task.id': taskId, 'task.state.status': 'running' },
        { $set: { 'task.state.lastError': 'claimed-elsewhere' } },
      )
    } catch {
      // 提示性写失败可忽略
    }
  }

  async get(id: string): Promise<TriggerTask | null> {
    try {
      return (await this.gateway.findById(id)) ?? null
    } catch (error) {
      this.reportFailure('query', 'get', error)
      throw error
    }
  }

  async query(query?: { habitatId?: string, ownerKey?: string, enabled?: boolean }): Promise<TriggerTask[]> {
    const filter: Record<string, unknown> = {}
    if (query?.habitatId !== undefined) filter['task.habitatId'] = query.habitatId
    if (query?.ownerKey !== undefined) filter['task.ownerKey'] = query.ownerKey
    if (query?.enabled !== undefined) filter['task.enabled'] = query.enabled
    try {
      return await this.gateway.findMany(filter)
    } catch (error) {
      this.reportFailure('query', 'query', error)
      throw error
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      const existing = await this.gateway.findById(id)
      if (!existing) return false
      await this.gateway.deleteById(id)
      return true
    } catch (error) {
      this.reportFailure('write', 'remove', error)
      throw error
    }
  }

  /**
   * 【D】到期收割直查：enabled + ($or: waiting 到期 / paused 恢复点到期) 单次
   * 服务端查询，按 nextRunAt 升序（对齐 _harvest 复合索引），取代 harvest 的
   * 全量 query() 拉取后内存过滤。
   */
  async listDue(now: number): Promise<TriggerTask[]> {
    try {
      return await this.gateway.findMany(
        {
          'task.enabled': true,
          $or: [
            { 'task.state.status': 'waiting', 'task.state.nextRunAt': { $ne: null, $lte: now } },
            { 'task.state.status': 'paused', 'task.state.pausedUntil': { $ne: null, $lte: now } },
          ],
        },
        { sort: { 'task.state.nextRunAt': 1 } },
      )
    } catch (error) {
      this.reportFailure('query', 'listDue', error)
      throw error
    }
  }

  /** 【D】计数化：countDocuments 服务端计数，取代 findMany 全拉后 length。 */
  async countByOwner(ownerKey: string): Promise<number> {
    try {
      return await this.gateway.count({ 'task.ownerKey': ownerKey })
    } catch (error) {
      this.reportFailure('query', 'countByOwner', error)
      throw error
    }
  }
}

/**
 * 双模式选择链（memory 插件同款 Mode B）：
 * - 'memory'：强制内存；
 * - 'auto'（默认）：elysia.persistence 可用且 mongo 模式时取集合句柄建 Mongo 仓储
 *   （索引 fire-and-forget 异步建，失败只记日志）；否则回退内存并 log mode。
 * 连接生命周期归 runtime 管，本层不 close。
 */
export function resolveTriggerTaskRepository(options: {
  repository: 'auto' | 'memory'
  getPersistence?: () => PersistenceService | undefined
  eventBus?: EventBus<CoreEventMap>
  logger?: { info(...args: unknown[]): void; debug(...args: unknown[]): void; warn?(...args: unknown[]): void; error(...args: unknown[]): void }
}): { repository: TriggerTaskRepository; mode: 'memory' | 'mongo' } {
  const { repository, getPersistence, eventBus, logger } = options

  if (repository !== 'memory') {
    try {
      const persistence = getPersistence?.()
      if (persistence?.mode === 'mongo') {
        const collection = persistence.getCollection<MongoTriggerTaskDocument>(MONGO_TRIGGER_TASKS_COLLECTION)
        if (collection) {
          const repo = new MongoTriggerTaskRepository(collection, {
            collectionName: MONGO_TRIGGER_TASKS_COLLECTION,
            eventBus,
          })
          // 两段式惰性建索引：同步返回仓储，索引异步建且失败不阻断（memory 插件同款）
          void repo.ensureIndexes().catch((error) => {
            logger?.error('failed to ensure mongo indexes for trigger tasks', error)
          })
          logger?.info('trigger task repository initialized in mongo mode', {
            collection: MONGO_TRIGGER_TASKS_COLLECTION,
          })
          return { repository: repo, mode: 'mongo' }
        }
      }
    } catch (error) {
      logger?.error('trigger task mongo repository init failed; falling back to memory', error)
    }
  }

  logger?.info('trigger task repository initialized in memory mode', {})
  return { repository: new MemoryTriggerTaskRepositoryForResolve(), mode: 'memory' }
}

// 延迟引用避免与 trigger-manager 循环 import：resolve 内 new 内存版
import { MemoryTriggerTaskRepository as MemoryTriggerTaskRepositoryForResolve } from './trigger-manager.js'
