/**
 * 事件目录：群聊/私聊环境预设刺激事件的单一事实来源。
 *
 * 参照 vtuber 的 event-catalog：每个目录项声明 feed 行标签、默认接收开关、
 * 默认清单包含与正文渲染；「接收（enabledEvents）」与「呈现给模型（feed.include）」
 * 是两层独立配置——接收决定事件进不进历史，呈现决定模型看不看得见。
 *
 * 分组语义：
 * - message / social：参与密度合并（可触发 LLM 唤醒）；
 * - system：只进事件清单供模型知情，不触发合并（vtuber 约定：
 *   system.* 事件由内部发射点控制，不作为唤醒源）。
 */

import type { Stimulus } from '@elysia-ai/core'
import type { TriggerEvent } from './event.js'

export type EventCatalogGroup = 'message' | 'social' | 'system'

export interface EventCatalogEntry {
  key: string
  group: EventCatalogGroup
  /** feed 行分类标签（"[HH:mm:ss] 标签 | 正文"） */
  label: string
  description: string
  /** 入站接收默认开关 */
  defaultEnabled: boolean
  /** 是否默认进事件清单（模型可见） */
  defaultFeedInclude: boolean
  /** feed 行正文渲染 */
  describe: (event: TriggerEvent) => string
}

function text(event: TriggerEvent): string {
  const content = event.payload.content
  return typeof content === 'string' ? content : ''
}

function actor(event: TriggerEvent): string {
  return event.actorName || event.actorId || '某人'
}

function quote(event: TriggerEvent): string {
  const content = event.payload.quoteContent
  return typeof content === 'string' && content !== '' ? `（引用：${truncate(content, 40)}）` : ''
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const EVENT_CATALOG: EventCatalogEntry[] = [
  {
    key: 'message',
    group: 'message',
    label: '消息',
    description: '群聊普通发言',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)}: ${text(event)}`,
  },
  {
    key: 'mention',
    group: 'message',
    label: '@',
    description: '有人 @ 了 bot',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} @了你: ${text(event)}`,
  },
  {
    key: 'reply',
    group: 'message',
    label: '回复',
    description: '有人引用消息发言（含引用 bot）',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} 回复道: ${text(event)}${quote(event)}`,
  },
  {
    key: 'direct-message',
    group: 'message',
    label: '私聊',
    description: '私聊消息',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)}（私聊）: ${text(event)}`,
  },
  {
    key: 'member-added',
    group: 'social',
    label: '进群',
    description: '新成员加入群聊',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} 加入了群聊`,
  },
  {
    key: 'member-removed',
    group: 'social',
    label: '退群',
    description: '成员离开群聊',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} 离开了群聊`,
  },
  {
    key: 'reaction',
    group: 'social',
    label: '回应',
    description: '对消息的表情回应',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} 回应了消息: ${String(event.payload.emoji ?? '')}`.trim(),
  },
  {
    key: 'bot-sent',
    group: 'system',
    label: '我',
    description: 'bot 自身发出的消息（模型自我认知来源）',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `你发送了: ${text(event)}`,
  },
  {
    key: 'system.command.executed',
    group: 'system',
    label: '指令',
    description: '用户指令已执行',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `${actor(event)} 的指令已执行: ${String(event.payload.command ?? '')}`.trim(),
  },
  {
    key: 'system.instant.sent',
    group: 'system',
    label: '即时',
    description: '即时规则自动回复已发出',
    defaultEnabled: true,
    defaultFeedInclude: true,
    describe: (event) => `即时规则「${String(event.payload.rule ?? '')}」自动回复: ${String(event.payload.content ?? '')}`.trim(),
  },
  {
    key: 'system.trigger.fired',
    group: 'system',
    label: '定时',
    description: '定时触发器到期执行',
    defaultEnabled: true,
    defaultFeedInclude: false,
    describe: (event) => `定时任务「${String(event.payload.name ?? '')}」到期`,
  },
]

const CATALOG_BY_KEY = new Map<string, EventCatalogEntry>(EVENT_CATALOG.map((entry) => [entry.key, entry]))

export function getCatalogEntry(key: string): EventCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key)
}

export function isSystemEventKey(key: string): boolean {
  return getCatalogEntry(key)?.group === 'system'
}

/** 是否默认参与密度合并（message/social 组）。 */
export function isBatchableEventKey(key: string): boolean {
  const group = getCatalogEntry(key)?.group
  return group === 'message' || group === 'social'
}

export interface EventSwitchConfig {
  /** 用户对每类型接收开关的覆写（缺省用目录 defaultEnabled） */
  enabledEvents?: Record<string, boolean>
  /** 用户对每类型清单呈现的覆写（缺省用目录 defaultFeedInclude） */
  feedInclude?: Record<string, boolean>
}

export function isEventEnabled(key: string, config: EventSwitchConfig): boolean {
  if (hasOverride(config.enabledEvents, key)) return config.enabledEvents![key]
  return getCatalogEntry(key)?.defaultEnabled ?? true
}

export function isFeedIncluded(key: string, config: EventSwitchConfig): boolean {
  if (hasOverride(config.feedInclude, key)) return config.feedInclude![key]
  return getCatalogEntry(key)?.defaultFeedInclude ?? true
}

function hasOverride(record: Record<string, boolean> | undefined, key: string): boolean {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
}

/**
 * Stimulus → TriggerEvent 派生（目录化唯一入口）。
 *
 * 映射规则：
 * - utterance：isDirectMessage > isMentioned > isReply > message 优先级取 key；
 * - addressing：视为 mention（内部合成寻址刺激）；
 * - appearance：payload.eventKind = member-added / member-removed；
 * - reaction：表情回应；
 * - system：payload.eventKind = bot-sent / system.command.executed /
 *   system.instant.sent / system.trigger.fired；
 * - silence：返回 null（静默唤醒由定时触发器承担，不是目录事件）。
 * 无法识别的事件返回 null（调用方丢弃并计数）。
 */
export function stimulusToTriggerEvent(stimulus: Stimulus): TriggerEvent | null {
  const key = deriveEventKey(stimulus)
  if (!key) return null

  const actorName = readString(stimulus.payload.actorName) ?? readString(stimulus.metadata?.actorName)
  return {
    key,
    timestamp: stimulus.timestamp,
    stimulusId: stimulus.id,
    habitatId: stimulus.habitatId,
    actorId: stimulus.actorId,
    ...(actorName ? { actorName } : {}),
    payload: stimulus.payload ?? {},
  }
}

function deriveEventKey(stimulus: Stimulus): string | null {
  switch (stimulus.type) {
    case 'utterance':
      if (stimulus.isDirectMessage) return 'direct-message'
      if (stimulus.isMentioned) return 'mention'
      if (stimulus.isReply) return 'reply'
      return 'message'
    case 'addressing':
      return 'mention'
    case 'appearance':
    case 'reaction':
    case 'system': {
      const eventKind = readString(stimulus.payload.eventKind)
      if (!eventKind) return null
      return CATALOG_BY_KEY.has(eventKind) ? eventKind : null
    }
    default:
      return null
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** feed 行渲染："[HH:mm:ss] 标签 | 正文"（vtuber 主播视角日志样式）。 */
export function formatEventFeedLine(event: TriggerEvent): string {
  const entry = getCatalogEntry(event.key)
  const label = entry?.label ?? event.key
  const body = entry ? entry.describe(event) : `${actor(event)} ${JSON.stringify(event.payload)}`
  return `[${formatClock(event.timestamp)}] ${label} | ${body}`
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
