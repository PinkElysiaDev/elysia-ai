import type { ScheduledTask, ScheduledTaskRepository } from '@elysia-ai/core'
import { MongoDocRepository, type MongoDocLikeCollection } from '@elysia-ai/shared'

// ─────────────────────────────────────────────────
// Mongo ScheduledTask 仓储（裸 driver，组合 MongoDocRepository）
//
// 文档形态：{ id, task: ScheduledTask, createdAt, updatedAt }。
// ScheduledTask 落库后调度器方可跨重启续跑。listDue 需 status+runAt 过滤再排序，
// 故按 status='pending' 服务端缩小后在内存做排序/截断（零语义偏移，复用内存版逻辑）。
// complete/fail/cancel 为单 id 状态迁移（读-改-写单条文档，非高并发计数，可接受）。
// ─────────────────────────────────────────────────

export interface MongoScheduledTaskDocument {
  id: string
  task: ScheduledTask
  createdAt: number
  updatedAt: number
}

export interface MongoScheduledTaskRepositoryOptions {
  collectionName?: string
  ensureIndexes?: boolean
}

function cloneTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    target: { ...task.target },
    payload: { ...task.payload },
    metadata: task.metadata ? { ...task.metadata } : undefined,
  }
}

export class MongoScheduledTaskRepository implements ScheduledTaskRepository {
  private readonly gateway: MongoDocRepository<ScheduledTask, MongoScheduledTaskDocument>

  constructor(
    collection: MongoDocLikeCollection<MongoScheduledTaskDocument>,
    options: MongoScheduledTaskRepositoryOptions = {},
  ) {
    const name = options.collectionName ?? 'elysia_scheduled_tasks'
    this.gateway = new MongoDocRepository<ScheduledTask, MongoScheduledTaskDocument>(collection, {
      modelKey: 'task',
      toModel: (doc) => doc.task,
      cloneModel: cloneTask,
      indexes: options.ensureIndexes === false ? [] : [
        { keys: { id: 1 }, options: { unique: true, name: `${name}_id_unique` } },
        { keys: { 'task.status': 1, 'task.runAt': 1 }, options: { name: `${name}_due` } },
        { keys: { 'task.target.lifeId': 1 }, options: { name: `${name}_life` } },
      ],
    })
  }

  async ensureIndexes(): Promise<void> {
    await this.gateway.ensureIndexes()
  }

  async save(task: ScheduledTask): Promise<void> {
    await this.gateway.upsert(task.id, task)
  }

  async getById(id: string): Promise<ScheduledTask | null> {
    return (await this.gateway.findById(id)) ?? null
  }

  async listDue(now: number, limit = 100): Promise<ScheduledTask[]> {
    const pending = await this.gateway.findMany({ 'task.status': 'pending' })
    return pending
      .filter((task) => task.runAt <= now)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return a.runAt - b.runAt
      })
      .slice(0, limit)
  }

  async listByLifeId(lifeId: string): Promise<ScheduledTask[]> {
    return this.gateway.findMany({ 'task.target.lifeId': lifeId })
  }

  async listAll(): Promise<ScheduledTask[]> {
    return this.gateway.findMany({})
  }

  async complete(id: string): Promise<void> {
    const task = await this.gateway.findById(id)
    if (!task) return
    await this.gateway.upsert(id, { ...task, status: 'completed', updatedAt: Date.now() })
  }

  async fail(id: string, error: string, nextRunAt?: number): Promise<void> {
    const task = await this.gateway.findById(id)
    if (!task) return
    const attempts = task.attempts + 1
    const shouldRetry = attempts < task.maxAttempts && typeof nextRunAt === 'number'
    await this.gateway.upsert(id, {
      ...task,
      attempts,
      status: shouldRetry ? 'pending' : 'failed',
      runAt: shouldRetry ? nextRunAt : task.runAt,
      updatedAt: Date.now(),
      lastError: error,
    })
  }

  async cancel(id: string, reason?: string): Promise<void> {
    const task = await this.gateway.findById(id)
    if (!task) return
    await this.gateway.upsert(id, {
      ...task,
      status: 'cancelled',
      updatedAt: Date.now(),
      metadata: { ...task.metadata, cancelReason: reason },
    })
  }

  async remove(id: string): Promise<void> {
    await this.gateway.deleteById(id)
  }
}
