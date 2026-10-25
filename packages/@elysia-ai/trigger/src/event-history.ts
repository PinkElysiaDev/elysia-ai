/**
 * 事件历史：per (lifeId × habitatId) 的滚动窗口事件存储。
 *
 * 参照 vtuber 的 EventHistory：固定时间窗（默认 30 分钟）+ 条数上限（默认 100）
 * 双重淘汰；feed 构建采用"先取 2 倍余量再过滤再截尾"策略，
 * 避免按 include 过滤后清单填不满 maxEvents。
 */

import type { TriggerEvent } from './event.js'
import { formatEventFeedLine, isFeedIncluded, type EventSwitchConfig } from './event-catalog.js'

export interface EventHistoryOptions {
  /** 条数上限（默认 100） */
  maxEvents?: number
  /** 时间窗毫秒（默认 30 分钟） */
  windowMs?: number
}

export interface FeedBuildOptions extends EventSwitchConfig {
  /** 清单最多呈现的事件行数 */
  maxEvents: number
}

export class EventHistory {
  private readonly maxEvents: number
  private readonly windowMs: number
  private events: TriggerEvent[] = []

  constructor(options: EventHistoryOptions = {}) {
    this.maxEvents = options.maxEvents ?? 100
    this.windowMs = options.windowMs ?? 30 * 60_000
  }

  record(event: TriggerEvent): void {
    this.events.push(event)
    this.prune(event.timestamp)
  }

  /** 最近 limit 条（时间升序，末尾为最新）；limit 缺省返回窗口内全部。 */
  recent(limit?: number): TriggerEvent[] {
    const source = limit === undefined ? this.events : this.events.slice(-limit)
    return [...source]
  }

  /** 最近事件时间戳（无事件返回 undefined）。 */
  lastEventAt(): number | undefined {
    return this.events.length ? this.events[this.events.length - 1].timestamp : undefined
  }

  size(): number {
    return this.events.length
  }

  /**
   * 构建事件清单行（"批只决定何时思考，清单决定模型看见什么"）。
   * 返回按时间升序的 feed 行数组；调用方 join('\n') 注入提示词。
   */
  buildFeedLines(config: FeedBuildOptions): string[] {
    // 取 2 倍余量：过滤（feedInclude）后仍能填满 maxEvents
    const source = this.recent(Math.max(config.maxEvents * 2, config.maxEvents))
    const included = source.filter((event) => isFeedIncluded(event.key, config))
    return included.slice(-config.maxEvents).map(formatEventFeedLine)
  }

  /** 窗口内（含余量）的事件快照，供 events pack 存档。 */
  snapshot(limit?: number): TriggerEvent[] {
    return this.recent(limit)
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs
    if (this.events.length && this.events[0].timestamp < cutoff) {
      this.events = this.events.filter((event) => event.timestamp >= cutoff)
    }
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents)
    }
  }
}
