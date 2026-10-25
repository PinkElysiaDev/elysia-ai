/**
 * 短期记忆（EventsPackMemory）：per-scope 环形缓冲，存档最近 N 次触发唤醒时的
 * events pack（事件快照 + 触发元数据）。
 *
 * 两条获取路径：
 * - 变量注入：唤醒提示组装时由 behavior 注入最近 N 次 pack（injectPacks 可配）；
 * - 模型工具：get_event_history 按需拉取历史 pack（分页/条数限制）。
 *
 * bot 自身发言经 bot-sent 事件进入后续 feed，天然覆盖"知道自己说过什么"；
 * 本记忆解决的是"上几次被唤醒时世界长什么样"的纵向连续性。
 */

import type { TriggerEvent } from './event.js'
import { formatEventFeedLine, isFeedIncluded, type EventSwitchConfig } from './event-catalog.js'

export type WakeSource = 'batcher' | 'instant' | 'scheduled' | 'manual'

export interface EventsPackEntry {
  /** 触发唤醒时刻 */
  firedAt: number
  source: WakeSource
  /** 触发原因描述（quiet/density/max-wait/max-batch 或规则/任务名） */
  reason: string
  /** 唤醒时的事件快照（该次呈现给模型的世界） */
  events: TriggerEvent[]
}

export interface PackMemoryOptions {
  /** 最大存档条数（默认 12） */
  maxPacks?: number
}

const SOURCE_LABELS: Record<WakeSource, string> = {
  batcher: '事件密度',
  instant: '即时规则',
  scheduled: '定时任务',
  manual: '手动',
}

export class EventsPackMemory {
  private readonly maxPacks: number
  private entries: EventsPackEntry[] = []

  constructor(options: PackMemoryOptions = {}) {
    this.maxPacks = options.maxPacks ?? 12
  }

  record(entry: EventsPackEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxPacks) {
      this.entries = this.entries.slice(this.entries.length - this.maxPacks)
    }
  }

  /** 最近 limit 次存档（时间升序，末尾为最新）；limit 缺省返回全部。 */
  recent(limit?: number): EventsPackEntry[] {
    const source = limit === undefined ? this.entries : this.entries.slice(-limit)
    return [...source]
  }

  size(): number {
    return this.entries.length
  }

  /**
   * 渲染一条 pack 存档为可读文本（模型工具与变量注入共用）。
   * maxLines 限制单 pack 呈现的事件行数（末尾最新）。
   */
  renderEntry(entry: EventsPackEntry, options: { maxLines?: number } & EventSwitchConfig = {}): string {
    const maxLines = options.maxLines ?? 15
    const lines = entry.events
      .filter((event) => isFeedIncluded(event.key, options))
      .slice(-maxLines)
      .map(formatEventFeedLine)
    const clock = formatClock(entry.firedAt)
    const head = `[${clock}] ${SOURCE_LABELS[entry.source]}触发（${entry.reason}，${entry.events.length} 条事件）`
    return lines.length ? `${head}\n${lines.join('\n')}` : head
  }
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
