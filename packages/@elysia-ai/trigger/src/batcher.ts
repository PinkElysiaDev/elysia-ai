/**
 * 密度自适应合并器（AdaptiveBatcher）。
 *
 * 移植自 vtuber 的 core/batcher.ts 并适配多 habitat 场景：
 * 不问"这条消息该不该触发"，而问"现在值得唤醒一次吗"——
 * 热闹时段一次 LLM 调用处理一整批，调用次数反而下降。
 *
 * 四条触发路径（优先级从高到低）：
 * - max-batch：单批条数达上限（push 时同步判定）；
 * - density：密度窗口内事件数达标，刷屏不再干等静默（push 时同步判定）；
 * - max-wait：批首事件起的最大等待，防热闹时段永不触发（tick 判定）；
 * - quiet：静默窗口到期（默认路径，tick 判定）。
 *
 * 定时驱动：宿主以 ≥200ms 间隔调用 tick()（行为插件接入 cordis dispose）；
 * 单元测试可直接注入 now。
 */

import type { TriggerEvent } from './event.js'

export type BatchReason = 'quiet' | 'density' | 'max-wait' | 'max-batch'

export interface BatchFire {
  events: TriggerEvent[]
  reason: BatchReason
}

export interface BatcherConfig {
  enabled: boolean
  /** 静默窗口：距最近事件静默该时长即触发（默认路径） */
  quietWindowMs: number
  /** 批最大等待；0 = 不设 */
  maxWaitMs: number
  /** 密度统计窗口 */
  densityWindowMs: number
  /** 密度阈值：窗口内事件数达标即触发；0 = 不启用 */
  densityThreshold: number
  /** 单批条数上限；0 = 不限 */
  maxBatch: number
}

export interface BatcherDeps {
  getConfig: () => BatcherConfig
  /** 收集谓词：系统事件等不参与合并（宿主决定） */
  shouldCollect: (event: TriggerEvent) => boolean
  onFire: (fire: BatchFire) => void
  /** 可注入时钟（测试用） */
  now?: () => number
}

export interface BatcherPendingState {
  count: number
  startedAt: number | null
  quietInMs: number | null
  maxWaitInMs: number | null
}

export const DEFAULT_BATCHER_CONFIG: BatcherConfig = {
  enabled: true,
  quietWindowMs: 8_000,
  maxWaitMs: 30_000,
  densityWindowMs: 10_000,
  densityThreshold: 15,
  maxBatch: 50,
}

export class AdaptiveBatcher {
  private readonly deps: BatcherDeps
  private batch: TriggerEvent[] = []
  private batchStartAt = 0
  private lastEventAt = 0
  private window: number[] = []
  private readonly firedCounts: Record<BatchReason, number> = { quiet: 0, density: 0, 'max-wait': 0, 'max-batch': 0 }

  constructor(deps: BatcherDeps) {
    this.deps = deps
  }

  push(event: TriggerEvent): void {
    if (!this.deps.shouldCollect(event)) return
    const config = this.deps.getConfig()
    if (!config.enabled) return

    const now = event.timestamp || this.now()
    if (this.batch.length === 0) this.batchStartAt = now
    this.batch.push(event)
    this.lastEventAt = now
    this.window.push(now)
    this.pruneWindow(now, config)

    if (config.maxBatch > 0 && this.batch.length >= config.maxBatch) {
      this.fire('max-batch')
      return
    }
    if (config.densityThreshold > 0 && this.window.length >= config.densityThreshold) {
      this.fire('density')
    }
  }

  tick(): void {
    if (this.batch.length === 0) return
    const config = this.deps.getConfig()
    if (!config.enabled) {
      this.clear()
      return
    }
    const now = this.now()

    if (config.maxWaitMs > 0 && now - this.batchStartAt >= config.maxWaitMs) {
      this.fire('max-wait')
      return
    }
    if (now - this.lastEventAt >= Math.max(0, config.quietWindowMs)) {
      this.fire('quiet')
    }
  }

  /** 当前批状态（观测用）。 */
  pending(): BatcherPendingState {
    const config = this.deps.getConfig()
    const now = this.now()
    return {
      count: this.batch.length,
      startedAt: this.batch.length ? this.batchStartAt : null,
      quietInMs: this.batch.length ? Math.max(0, config.quietWindowMs - (now - this.lastEventAt)) : null,
      maxWaitInMs: this.batch.length && config.maxWaitMs > 0
        ? Math.max(0, config.maxWaitMs - (now - this.batchStartAt))
        : null,
    }
  }

  /** 四路径累计触发计数（观测用）。 */
  stats(): Record<BatchReason, number> {
    return { ...this.firedCounts }
  }

  private fire(reason: BatchReason): void {
    const events = this.batch
    this.clear()
    this.firedCounts[reason] += 1
    this.deps.onFire({ events, reason })
  }

  private clear(): void {
    this.batch = []
    this.window = []
    this.batchStartAt = 0
    this.lastEventAt = 0
  }

  private pruneWindow(now: number, config: BatcherConfig): void {
    const cutoff = now - config.densityWindowMs
    this.window = this.window.filter((ts) => ts > cutoff)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
