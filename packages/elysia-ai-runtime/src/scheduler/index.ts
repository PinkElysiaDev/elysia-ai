import type {
  CoreEventMap,
  EventBus,
  NewScheduledTask,
  ScheduledTask,
  ScheduledTaskExecutionResult,
  ScheduledTaskRepository,
  SchedulerLoopOptions,
  Stimulus,
} from '@elysia-ai/core'
import type { RuntimeLogger } from '../context/index.js'

export interface TimerScheduler {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export type ScheduledTaskHandler = (task: ScheduledTask) => Promise<void>

export interface SchedulerService {
  schedule(task: NewScheduledTask): Promise<ScheduledTask>
  cancel(taskId: string, reason?: string): Promise<void>
  tick(now?: number, limit?: number): Promise<ScheduledTaskExecutionResult[]>
  startLoop?(options?: Partial<SchedulerLoopOptions>): void
  stopLoop?(): void
  runTask(task: ScheduledTask): Promise<ScheduledTaskExecutionResult>
  listTasks(): Promise<ScheduledTask[]>
}

function cloneTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    target: { ...task.target },
    payload: { ...task.payload },
    metadata: task.metadata ? { ...task.metadata } : undefined,
  }
}

function createTaskId(): string {
  return `scheduled-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeNewScheduledTask(task: NewScheduledTask, now = Date.now()): ScheduledTask {
  return {
    id: task.id ?? createTaskId(),
    type: task.type,
    status: 'pending',
    target: task.target ?? {},
    runAt: task.runAt,
    createdAt: now,
    updatedAt: now,
    priority: task.priority ?? 0,
    payload: task.payload ?? {},
    metadata: task.metadata,
    attempts: 0,
    maxAttempts: task.retryPolicy?.maxAttempts ?? task.maxAttempts ?? 1,
    retryPolicy: task.retryPolicy,
    expiresAt: task.expiresAt,
  }
}

export class MemoryScheduledTaskRepository implements ScheduledTaskRepository {
  private readonly tasks = new Map<string, ScheduledTask>()

  async save(task: ScheduledTask): Promise<void> {
    this.tasks.set(task.id, cloneTask(task))
  }

  async getById(id: string): Promise<ScheduledTask | null> {
    const task = this.tasks.get(id)
    return task ? cloneTask(task) : null
  }

  async listDue(now: number, limit = 100): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values())
      .filter((task) => task.status === 'pending')
      .filter((task) => task.runAt <= now)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return a.runAt - b.runAt
      })
      .slice(0, limit)
      .map(cloneTask)
  }

  async listByLifeId(lifeId: string): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values())
      .filter((task) => task.target.lifeId === lifeId)
      .map(cloneTask)
  }

  async listAll(): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values()).map(cloneTask)
  }

  async complete(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return

    this.tasks.set(id, {
      ...task,
      status: 'completed',
      updatedAt: Date.now(),
    })
  }

  async fail(id: string, error: string, nextRunAt?: number): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return

    const attempts = task.attempts + 1
    const shouldRetry = attempts < task.maxAttempts && typeof nextRunAt === 'number'
    this.tasks.set(id, {
      ...task,
      attempts,
      status: shouldRetry ? 'pending' : 'failed',
      runAt: shouldRetry ? nextRunAt : task.runAt,
      updatedAt: Date.now(),
      lastError: error,
    })
  }

  async cancel(id: string, reason?: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return

    this.tasks.set(id, {
      ...task,
      status: 'cancelled',
      updatedAt: Date.now(),
      metadata: {
        ...task.metadata,
        cancelReason: reason,
      },
    })
  }

  async remove(id: string): Promise<void> {
    this.tasks.delete(id)
  }
}

export class DefaultSchedulerService implements SchedulerService {
  private loopTimer: unknown
  private ticking = false

  constructor(
    private readonly repository: ScheduledTaskRepository,
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly handlers: Partial<Record<ScheduledTask['type'], ScheduledTaskHandler>> = {},
    private readonly logger?: RuntimeLogger,
  ) {}

  async schedule(task: NewScheduledTask): Promise<ScheduledTask> {
    const scheduledTask = normalizeNewScheduledTask(task)
    await this.repository.save(scheduledTask)

    await this.eventBus.emit('scheduler.task.created', {
      taskId: scheduledTask.id,
      task: scheduledTask,
    })

    this.logger?.debug('scheduled task created', {
      phase: 'scheduler',
      taskId: scheduledTask.id,
      taskType: scheduledTask.type,
      runAt: scheduledTask.runAt,
    })

    return scheduledTask
  }

  async cancel(taskId: string, reason?: string): Promise<void> {
    await this.repository.cancel(taskId, reason)
    const task = await this.repository.getById(taskId)
    if (!task) return

    await this.eventBus.emit('scheduler.task.cancelled', {
      taskId,
      task,
      reason,
    })

    this.logger?.debug('scheduled task cancelled', {
      phase: 'scheduler',
      taskId,
      reason,
    })
  }

  async tick(now = Date.now(), limit = 100): Promise<ScheduledTaskExecutionResult[]> {
    if (this.ticking) return []

    this.ticking = true
    try {
      return await this.tickOnce(now, limit)
    } finally {
      this.ticking = false
    }
  }

  startLoop(options: Partial<SchedulerLoopOptions> = {}): void {
    if (this.loopTimer) return

    const tickIntervalMs = options.tickIntervalMs ?? 1000
    const batchSize = options.batchSize ?? 100

    this.loopTimer = setInterval(() => {
      void this.tick(Date.now(), batchSize).catch((error) => {
        // tick 内部对单个 task 失败已有兜底；此处兜住 listDue 等整体性失败，
        // 否则 setInterval 回调里的 promise 拒绝会被静默丢弃，调度循环异常无从观测。
        this.logger?.error('scheduler tick loop failed', error, {
          phase: 'scheduler',
        })
      })
    }, tickIntervalMs)
  }

  stopLoop(): void {
    if (!this.loopTimer) return
    clearInterval(this.loopTimer as ReturnType<typeof setInterval>)
    this.loopTimer = undefined
  }

  private async tickOnce(now: number, limit: number): Promise<ScheduledTaskExecutionResult[]> {
    const tasks = await this.repository.listDue(now, limit)
    const results: ScheduledTaskExecutionResult[] = []

    for (const task of tasks) {
      if (typeof task.expiresAt === 'number' && task.expiresAt <= now) {
        const expired: ScheduledTask = {
          ...task,
          status: 'expired',
          updatedAt: now,
        }
        await this.repository.save(expired)
        await this.eventBus.emit('scheduler.task.expired', {
          taskId: expired.id,
          task: expired,
        })
        results.push({
          taskId: expired.id,
          completed: false,
          error: new Error('scheduled task expired'),
        })
        continue
      }

      results.push(await this.runTask(task))
    }

    return results
  }

  async runTask(task: ScheduledTask): Promise<ScheduledTaskExecutionResult> {
    const running: ScheduledTask = {
      ...task,
      status: 'running',
      updatedAt: Date.now(),
    }
    await this.repository.save(running)

    await this.eventBus.emit('scheduler.task.started', {
      taskId: running.id,
      task: running,
    })

    try {
      await this.dispatch(running)
      await this.repository.complete(running.id)
      const completed = await this.repository.getById(running.id)

      await this.eventBus.emit('scheduler.task.completed', {
        taskId: running.id,
        task: completed ?? {
          ...running,
          status: 'completed',
          updatedAt: Date.now(),
        },
      })

      this.logger?.debug('scheduled task completed', {
        phase: 'scheduler',
        taskId: running.id,
        taskType: running.type,
      })

      return {
        taskId: running.id,
        completed: true,
      }
    } catch (error) {
      const nextRunAt = calculateNextRunAt(running)
      await this.repository.fail(running.id, error instanceof Error ? error.message : String(error), nextRunAt)
      const failed = await this.repository.getById(running.id)

      await this.eventBus.emit('scheduler.task.failed', {
        taskId: running.id,
        task: failed ?? running,
        error,
      })

      this.logger?.error('scheduled task failed', error, {
        phase: 'scheduler',
        taskId: running.id,
        taskType: running.type,
      })

      return {
        taskId: running.id,
        completed: false,
        error,
        retryScheduled: Boolean(nextRunAt),
        nextRunAt,
      }
    }
  }

  async listTasks(): Promise<ScheduledTask[]> {
    return this.repository.listAll()
  }

  private async dispatch(task: ScheduledTask): Promise<void> {
    const handler = this.handlers[task.type]
    if (handler) {
      await handler(task)
      return
    }

    // Phase 18 的默认 follow-up 行为：
    // 将任务 payload 中显式提供的 stimulus 重新注入主链。
    // 这保持 scheduler 自身克制，不在此阶段发明复杂主动行为策略。
    if (task.type === 'followup') {
      const stimulus = task.payload['stimulus']
      if (isStimulus(stimulus)) {
        await this.eventBus.emit('stimulus.received', {
          stimulusId: stimulus.id,
          stimulus,
        })
      }
    }
  }
}

function calculateNextRunAt(task: ScheduledTask): number | undefined {
  const maxAttempts = task.retryPolicy?.maxAttempts ?? task.maxAttempts
  if (task.attempts + 1 >= maxAttempts) return undefined

  const baseDelayMs = task.retryPolicy?.baseDelayMs
  if (typeof baseDelayMs !== 'number') return undefined

  const backoff = task.retryPolicy?.backoff ?? 'fixed'
  const multiplier = backoff === 'exponential'
    ? 2 ** task.attempts
    : 1
  const delay = Math.min(
    baseDelayMs * multiplier,
    task.retryPolicy?.maxDelayMs ?? baseDelayMs * multiplier,
  )

  return Date.now() + delay
}

function isStimulus(value: unknown): value is Stimulus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<Stimulus>
  return typeof candidate.id === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.timestamp === 'number'
    && typeof candidate.habitatId === 'string'
}
