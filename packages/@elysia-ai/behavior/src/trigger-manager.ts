/**
 * 定时触发器管理器：任务存储 + 到期收割 + LLM/管理员 CRUD。
 *
 * 与即时响应同等地位（source='scheduled' 的唤醒）。设计要点：
 * - 单循环收割（1s tick 检查 nextRunAt），任务表持久化在仓储；
 * - 防重入：running 中的任务到期重入直接跳过（记 lastError）；
 * - misfire：重启后过期任务按策略补跑一次或跳到下个周期；
 * - 权限双闸门（chatluna 精简版）：管理员（白名单+宿主回调）管全部，
 *   普通用户不可建（v1）；创建目标锁定当前 habitat。
 */

import type { TriggerTaskRepository } from '@elysia-ai/core'
import type { TriggerTask } from '@elysia-ai/trigger'
import {
  afterTriggerRun,
  computeNextOccurrence,
  initialTriggerState,
  normalizeTriggerCondition,
  resolveMisfire,
} from '@elysia-ai/trigger'
import type { TriggerWakeSource } from '@elysia-ai/core'

export interface TriggerManagerConfig {
  enabled: boolean
  /** 允许让 LLM/命令管理触发器的用户白名单（uid） */
  adminWhitelist: string[]
  maxTasksPerOwner: number
}

export interface TriggerAdminActor {
  userId?: string
  platform?: string
  botId?: string
}

export interface TriggerFireRequest {
  task: TriggerTask
  source: TriggerWakeSource
  /** 广播任务展开后的有效目标（缺省 = task.habitatId） */
  habitatId?: string
  /** 广播展开时解析出的真实 lifeId（防空串哨兵绕过多 life 守卫） */
  lifeId?: string
  /** 任务持久化的路由快照（重启后 habitatRouting 内存缓存空时的发送目标恢复） */
  routing?: TriggerTask['routing']
}

export interface TriggerManagerDeps {
  store: TriggerTaskRepository
  config: () => TriggerManagerConfig
  /** 触发回调（behavior 的 fireTrigger） */
  fire: (request: TriggerFireRequest) => void
  /** 广播任务（habitatId='*'）展开：枚举该 life 的全部活跃窗口（携带真实 lifeId） */
  listHabitats?: (lifeId?: string) => Array<{ lifeId: string, habitatId: string }>
  /** 管理员判定（宿主回调：koishi authority 或白名单） */
  checkAdmin?: (actor: TriggerAdminActor) => Promise<boolean>
  now?: () => number
  onCreateTask?: (task: TriggerTask) => void
  onRemoveTask?: (task: TriggerTask) => void
  logger?: { warn?(...args: unknown[]): void; error(...args: unknown[]): void }
}

const HARVEST_INTERVAL_MS = 1_000

export class TriggerManager {
  private readonly deps: TriggerManagerDeps
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private started = false
  /** harvest 互斥：上一轮收割未完成时跳过本轮（1s tick 与慢查询错峰）。 */
  private harvesting = false

  constructor(deps: TriggerManagerDeps) {
    this.deps = deps
  }

  async start(): Promise<void> {
    if (this.started || !this.deps.config().enabled) return
    this.started = true
    // 重启恢复：重算排程（过期任务按 misfire 策略标记补跑或跳期）。
    // 【D】此处保留全量 query() 而非 listDue(now)：恢复语义需要全部任务快照——
    // error 态复活、waiting+nextRunAt=null 修复、未到期 waiting 的 misfire 预判
    // 都不在 listDue 的"到期"定义内；且仅启动时执行一次，无热路径成本。
    const tasks = await this.deps.store.query()
    const now = this.now()
    for (const task of tasks) {
      // error 任务重启复活：重排下个 occurrence（reschedule 保留 runCount 历史）
      if (task.state.status === 'error') {
        await this.reschedule(task, now)
        continue
      }
      if (task.state.status === 'running' || task.state.status === 'waiting') {
        if (task.state.nextRunAt === null || task.state.nextRunAt === undefined) {
          await this.reschedule(task, now)
          continue
        }
        if (task.state.nextRunAt <= now && resolveMisfire(task.condition, task.state.nextRunAt, now) === 'skip') {
          await this.reschedule(task, now)
        } else {
          task.state.status = 'waiting'
          await this.deps.store.save(task)
        }
      }
    }
    this.timer = setInterval(() => void this.harvest(), HARVEST_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.started = false
  }

  private async harvest(): Promise<void> {
    if (!this.deps.config().enabled) return
    // async 互斥：harvest 由 1s 定时器驱动，一轮内含多次 await（查询/写仓储），
    // 慢查询叠加时会与下一轮 tick 重叠导致同任务并发收割；重入直接跳过。
    if (this.harvesting) return
    this.harvesting = true
    try {
      const now = this.now()
      // 【D】到期收割直查：仓储侧完成 enabled/waiting/paused 过滤
      // （Mongo 下推为 $or 服务端查询，内存为进程内过滤），不再全量拉取。
      let due: TriggerTask[]
      try {
        due = await this.deps.store.listDue(now)
      } catch (error) {
        this.deps.logger?.error('trigger harvest query failed', error)
        return
      }
      for (const task of due) {
        await this.runTask(task, now)
      }
    } finally {
      this.harvesting = false
    }
  }

  /** 广播任务（habitatId='*'）展开为该 life 的全部活跃窗口（携带真实 lifeId）。 */
  private expandBroadcast(task: TriggerTask): Array<{ lifeId: string, habitatId: string }> {
    return this.deps.listHabitats?.(task.lifeId) ?? []
  }

  private async runTask(task: TriggerTask, now: number): Promise<void> {
    if (this.running.has(task.id)) {
      // 同上：不整写收割快照（会覆盖运行中实例的最终状态写）
      this.deps.logger?.warn?.('trigger task already running in this process; skipping', { taskId: task.id })
      return
    }

    // pause_until 到期：恢复排程（重排下个 occurrence），不在此刻补跑。
    // W3：与 update/enable/resume 一致走 reschedulePreservingHistory，runCount/lastRunAt 不清零。
    if (task.state.status === 'paused') {
      this.reschedulePreservingHistory(task, now)
      task.updatedAt = now
      await this.deps.store.save(task)
      return
    }

    this.running.add(task.id)
    try {
      // P3a 防重核心：CAS 认领。occurrenceKey 是"第几轮触发"的编号——
      // 仅当任务仍是 waiting 且轮次未被别处认领时才置 running。
      // 内存模式由本进程抢到；多进程共享 Mongo 时后到者抢不到即跳过。
      const occurrenceKey = task.state.occurrenceKey
      const claimed = occurrenceKey !== null
        && await this.deps.store.claim(task.id, occurrenceKey, now)
      if (!claimed) {
        // 不整写快照：收割快照可能是过期态（已被他处认领 running/删除/暂停），
        // 整体 save 会覆盖写者的新状态（多进程重复点火/删除复活/暂停回滚）。
        // lastError 经条件窄写：仅当仍处 running（认领者所为）时附带提示。
        await this.deps.store.markClaimConflict?.(task.id)
        this.deps.logger?.warn?.('trigger occurrence claimed elsewhere; skipping duplicate fire', { taskId: task.id })
        return
      }
      task.state.status = 'running'
      await this.deps.store.save(task)

      let skipNote: string | null = null
      if (task.habitatId === '*') {
        // 广播：对每个活跃窗口各点火一次（复用各窗口自己的 feed/pack/routing）；
        // 无活跃窗口时跳过本次并记录（afterRun 会清 lastError，故重排后回写），排程照常推进。
        const habitats = this.expandBroadcast(task)
        if (habitats.length === 0) {
          skipNote = 'no active habitats for broadcast'
        } else {
          for (const target of habitats) {
            this.deps.fire({ task, source: 'scheduled', habitatId: target.habitatId, lifeId: target.lifeId })
          }
        }
      } else {
        this.deps.fire({ task, source: 'scheduled', routing: task.routing })
      }

      const nextState = afterTriggerRun(task, now)
      if (skipNote) nextState.lastError = skipNote
      // W3：运行期写竞态防御——最终 save 前重读 store，若任务已不处于 running
      // （被 pause_until/remove/update 抢先改写），放弃本次状态回写，只 warn 不覆盖。
      const latest = await this.deps.store.get(task.id)
      if (!latest || latest.state.status !== 'running') {
        this.deps.logger?.warn?.('trigger task state changed during run; discarding final state write', { taskId: task.id, status: latest?.state.status ?? 'removed' })
        return
      }
      await this.deps.store.save({ ...task, state: nextState, updatedAt: now })
    } catch (error) {
      task.state.status = 'error'
      task.state.lastError = error instanceof Error ? error.message : String(error)
      await this.deps.store.save(task)
      this.deps.logger?.error('trigger task run failed', error, { taskId: task.id })
    } finally {
      this.running.delete(task.id)
    }
  }

  private async reschedule(task: TriggerTask, now: number): Promise<void> {
    const occurrence = computeNextOccurrence(task.condition, now, { taskAnchor: task.createdAt, taskId: task.id })
    task.state = occurrence
      ? { ...task.state, status: 'waiting', nextRunAt: occurrence.at, occurrenceKey: occurrence.occurrenceKey }
      : { ...task.state, status: 'completed', nextRunAt: null, occurrenceKey: null }
    await this.deps.store.save(task)
  }

  /** 重排（initialTriggerState 重算 occurrence）后回填运行历史：runCount/lastRunAt 不清零。 */
  private reschedulePreservingHistory(task: TriggerTask, now: number): void {
    const { runCount, lastRunAt } = task.state
    task.state = { ...initialTriggerState(task, now), runCount, lastRunAt }
  }

  // ── CRUD（LLM trigger 工具与管理命令共用）──

  async isAdmin(actor: TriggerAdminActor | undefined): Promise<boolean> {
    if (!actor) return false
    if (actor.userId && this.deps.config().adminWhitelist.includes(actor.userId)) return true
    if (this.deps.checkAdmin) return this.deps.checkAdmin(actor)
    return false
  }

  async list(): Promise<TriggerTask[]> {
    return this.deps.store.query()
  }

  async get(id: string): Promise<TriggerTask | null> {
    return this.deps.store.get(id)
  }

  async create(input: {
    name: string
    habitatId: string
    lifeId?: string
    condition: TriggerTask['condition']
    prompt: string
    ownerKey: string
    routing?: TriggerTask['routing']
  }): Promise<TriggerTask | { error: string }> {
    const config = this.deps.config()
    if (!config.enabled) return { error: 'trigger system disabled' }
    const normalized = normalizeTriggerCondition(input.condition)
    if ('error' in normalized) return { error: normalized.error }
    const existing = await this.deps.store.countByOwner(input.ownerKey)
    if (existing >= config.maxTasksPerOwner) {
      return { error: `owner quota exceeded (max ${config.maxTasksPerOwner})` }
    }
    const now = this.now()
    const task: TriggerTask = {
      id: `trigger-${now}-${Math.random().toString(36).slice(2, 10)}`,
      name: input.name,
      enabled: true,
      lifeId: input.lifeId,
      habitatId: input.habitatId,
      condition: normalized,
      prompt: input.prompt,
      ownerKey: input.ownerKey,
      ...(input.routing ? { routing: input.routing } : {}),
      createdAt: now,
      updatedAt: now,
      state: initialTriggerState(
        { id: '', name: '', enabled: true, habitatId: '', condition: normalized, prompt: '', ownerKey: '', createdAt: now, updatedAt: now, state: null as never },
        now,
      ),
    }
    task.state = initialTriggerState(task, now)
    await this.deps.store.save(task)
    this.deps.onCreateTask?.(task)
    return task
  }

  async update(id: string, patch: Partial<Pick<TriggerTask, 'name' | 'enabled' | 'condition' | 'prompt'>>): Promise<TriggerTask | { error: string }> {
    const task = await this.deps.store.get(id)
    if (!task) return { error: `trigger "${id}" not found` }
    if (patch.condition) {
      const normalized = normalizeTriggerCondition(patch.condition)
      if ('error' in normalized) return { error: normalized.error }
      task.condition = normalized
      // 改定义必然重排程（chatluna 语义），保留历史统计
      this.reschedulePreservingHistory(task, this.now())
    }
    if (patch.name !== undefined) task.name = patch.name
    if (patch.prompt !== undefined) task.prompt = patch.prompt
    if (patch.enabled !== undefined) {
      task.enabled = patch.enabled
      if (!patch.enabled) {
        task.state = { ...task.state, status: 'paused', nextRunAt: null, occurrenceKey: null }
      } else {
        this.reschedulePreservingHistory(task, this.now())
      }
    }
    task.updatedAt = this.now()
    await this.deps.store.save(task)
    return task
  }

  async pauseUntil(id: string, untilMs: number): Promise<TriggerTask | { error: string }> {
    const task = await this.deps.store.get(id)
    if (!task) return { error: `trigger "${id}" not found` }
    const now = this.now()
    if (untilMs <= now) return { error: 'pause_until must be a future timestamp' }
    task.state = { ...task.state, status: 'paused', nextRunAt: untilMs, pausedUntil: untilMs }
    task.updatedAt = now
    await this.deps.store.save(task)
    return task
  }

  async resume(id: string): Promise<TriggerTask | { error: string }> {
    const task = await this.deps.store.get(id)
    if (!task) return { error: `trigger "${id}" not found` }
    // W2-8：resume 不再隐式 enable——disabled 任务的启停由 enable/disable 独立管理，
    // 强行复活会把用户显式关闭的任务拉回排程。
    if (!task.enabled) return { error: 'task is disabled; use enable instead' }
    this.reschedulePreservingHistory(task, this.now())
    task.updatedAt = this.now()
    await this.deps.store.save(task)
    return task
  }

  async remove(id: string): Promise<TriggerTask | { error: string }> {
    const task = await this.deps.store.get(id)
    if (!task) return { error: `trigger "${id}" not found` }
    await this.deps.store.remove(id)
    this.deps.onRemoveTask?.(task)
    return task
  }

  /** 立即试跑（fire）：不改变排程（manual 语义）。广播任务同样展开到全部活跃窗口。 */
  async fire(id: string): Promise<TriggerTask | { error: string }> {
    const task = await this.deps.store.get(id)
    if (!task) return { error: `trigger "${id}" not found` }
    if (this.running.has(id)) return { error: 'task already running' }
    this.running.add(id)
    try {
      if (task.habitatId === '*') {
        // 广播试跑与定时收割同语义：逐活跃窗口点火；无活跃窗口视为无效试跑。
        const habitats = this.expandBroadcast(task)
        if (habitats.length === 0) {
          return { error: 'no active habitats' }
        }
        for (const target of habitats) {
          this.deps.fire({ task, source: 'manual', habitatId: target.habitatId, lifeId: target.lifeId })
        }
      } else {
        this.deps.fire({ task, source: 'manual', routing: task.routing })
      }
      return task
    } finally {
      this.running.delete(id)
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

/** 内存仓储（v1 默认；重启丢失，重要任务建议 manifest 层面声明）。 */
export class MemoryTriggerTaskRepository implements TriggerTaskRepository {
  private store = new Map<string, TriggerTask>()

  async save(task: TriggerTask): Promise<void> {
    this.store.set(task.id, { ...task, state: { ...task.state } })
  }

  async claim(taskId: string, expectedOccurrenceKey: string, now: number): Promise<boolean> {
    // 进程内同步 CAS：单进程无跨进程竞争，仍校验轮次防同进程竞态残留
    const task = this.store.get(taskId)
    if (!task || task.state.status !== 'waiting' || task.state.occurrenceKey !== expectedOccurrenceKey) {
      return false
    }
    task.state.status = 'running'
    task.state.lastRunAt = now
    this.store.set(taskId, task)
    return true
  }

  async markClaimConflict(taskId: string): Promise<void> {
    const task = this.store.get(taskId)
    if (task && task.state.status === 'running') {
      task.state.lastError = 'claimed-elsewhere'
      this.store.set(taskId, task)
    }
  }

  async get(id: string): Promise<TriggerTask | null> {
    const task = this.store.get(id)
    return task ? { ...task, state: { ...task.state } } : null
  }

  async query(query?: { habitatId?: string, ownerKey?: string, enabled?: boolean }): Promise<TriggerTask[]> {
    let tasks = [...this.store.values()]
    if (query?.habitatId) tasks = tasks.filter((task) => task.habitatId === query.habitatId)
    if (query?.ownerKey) tasks = tasks.filter((task) => task.ownerKey === query.ownerKey)
    if (query?.enabled !== undefined) tasks = tasks.filter((task) => task.enabled === query.enabled)
    return tasks.map((task) => ({ ...task, state: { ...task.state } }))
  }

  /**
   * 【D】到期收割直查（内存版）：与 harvest 原过滤逻辑一致——enabled 且
   * waiting+nextRunAt<=now（到期待跑）或 paused+pausedUntil<=now（恢复点到期）。
   */
  async listDue(now: number): Promise<TriggerTask[]> {
    return [...this.store.values()]
      .filter((task) => task.enabled && (
        (task.state.status === 'waiting'
          && task.state.nextRunAt !== null
          && task.state.nextRunAt <= now)
        || (task.state.status === 'paused'
          && task.state.pausedUntil !== null
          && task.state.pausedUntil <= now)
      ))
      .map((task) => ({ ...task, state: { ...task.state } }))
  }

  async remove(id: string): Promise<boolean> {
    return this.store.delete(id)
  }

  async countByOwner(ownerKey: string): Promise<number> {
    return [...this.store.values()].filter((task) => task.ownerKey === ownerKey).length
  }
}
