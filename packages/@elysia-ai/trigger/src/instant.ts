/**
 * 即时应对引擎（第二层：规则触发器）。
 *
 * 条件矩阵按事件类型字段化；判分语义与 vtuber instant 一致：
 * 同 key 多值任一命中（OR），跨 key 全部满足（AND）；全部条件可空 = 不限。
 * 三种动作：llm（插队唤醒，带定向指令）/ send-text（模板直发）。
 * 每规则独立冷却；send-text 发送失败不消耗冷却（防限流期规则永久哑火）。
 */

import type { TriggerEvent } from './event.js'
import { expandTemplate, type MatchInfo } from './template.js'
import { isSystemEventKey } from './event-catalog.js'

export interface InstantCondition {
  /** 内容包含任一关键词（OR） */
  keywords?: string[]
  /** 正则（任一命中；捕获组供 {{match.N}}；全部非法视为不命中防误触发） */
  regex?: string[]
  /** 内容以任一前缀开头（OR） */
  startsWith?: string[]
  /** 发起者白名单 */
  uids?: string[]
}

export type InstantAction =
  | { type: 'llm'; directive?: string }
  | { type: 'send-text'; template: string }

export interface InstantItem {
  id: string
  name: string
  enabled: boolean
  /** 目标事件目录 key（mention / message / direct-message / member-added / …） */
  eventKey: string
  condition?: InstantCondition
  action: InstantAction
  /** 每规则冷却（毫秒）；0 = 不限 */
  cooldownMs: number
  /** send-text 命中后写 system.instant.sent 事件（默认 true） */
  announceToFeed?: boolean
}

export interface InstantMatchResult {
  item: InstantItem
  match?: MatchInfo
}

export interface InstantEngineDeps {
  getConfig: () => InstantItem[]
  now?: () => number
}

/** 默认即时规则：被@必应、私聊必应（绕过静默窗插队唤醒）。
 * W2-10：默认带 3s 小冷却——防连续 @ 刷屏时的唤醒成本放大（可显式覆盖为 0）。 */
export const DEFAULT_INSTANT_RULES: InstantItem[] = [
  {
    id: 'mention-must-respond',
    name: '被@必应',
    enabled: true,
    eventKey: 'mention',
    action: { type: 'llm', directive: '有人在群里@了你，通常需要回应；请查看事件清单并调用 send_reply 回复对方。' },
    cooldownMs: 3000,
  },
  {
    id: 'direct-message-must-respond',
    name: '私聊必应',
    enabled: true,
    eventKey: 'direct-message',
    action: { type: 'llm', directive: '收到私聊消息，请查看事件清单并调用 send_reply 回复对方。' },
    cooldownMs: 3000,
  },
]

export class InstantEngine {
  private readonly deps: InstantEngineDeps
  private readonly lastAt = new Map<string, number>()
  private readonly regexCache = new Map<string, RegExp | null>()

  constructor(deps: InstantEngineDeps) {
    this.deps = deps
  }

  /**
   * 匹配事件。命中返回首个"匹配 + 过冷却"的规则（一次事件只触发一条）；
   * 冷却判定独立于动作执行结果——冷却消耗时机由调用方按动作类型决定：
   * llm 进入即消耗；send-text 仅实际发出才消耗。
   */
  match(event: TriggerEvent): InstantMatchResult | undefined {
    // 系统组事件（bot-sent / system.*）不可作即时触发源：llm 动作会造成
    // bot 看到自己发言→唤醒→再发言的无限自问自答死循环（架构原则：
    // 系统事件只进清单不触发唤醒）。
    if (isSystemEventKey(event.key)) return undefined
    for (const item of this.deps.getConfig()) {
      if (!item.enabled || item.eventKey !== event.key) continue
      const match = matchesCondition(item.condition, event, this.regexCache)
      if (!match) continue
      // W2-9：冷却按 habitat 隔离——A 群触发冷却中不影响 B 群同规则触发。
      const cooldownKey = `${item.id}:${event.habitatId}`
      if (item.cooldownMs > 0 && this.now() - (this.lastAt.get(cooldownKey) ?? 0) < item.cooldownMs) continue
      return { item, match }
    }
    return undefined
  }

  /** 消耗冷却（动作实际生效时调用）。W2-9：冷却作用域限定单一 habitat。 */
  consumeCooldown(item: InstantItem, habitatId: string): void {
    if (item.cooldownMs > 0) this.lastAt.set(`${item.id}:${habitatId}`, this.now())
  }

  expand(action: { template: string }, event: TriggerEvent, match?: MatchInfo): string {
    return expandTemplate(action.template, event, match)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function matchesCondition(
  condition: InstantCondition | undefined,
  event: TriggerEvent,
  regexCache: Map<string, RegExp | null>,
): MatchInfo | undefined {
  if (!condition) return {}
  const content = readContent(event)

  let regexMatch: RegExpMatchArray | undefined
  if (condition.regex?.length) {
    let matched = false
    for (const pattern of condition.regex) {
      const regex = getRegex(pattern, regexCache)
      if (!regex) continue
      const result = regex.exec(content)
      if (result) {
        matched = true
        regexMatch = result
        break
      }
    }
    // 任一命中才算过；全部非法或无一命中 → 不命中（防误触发）
    if (!matched) return undefined
  }

  if (condition.keywords?.length && !condition.keywords.some((keyword) => content.includes(keyword))) {
    return undefined
  }
  if (condition.startsWith?.length && !condition.startsWith.some((prefix) => content.startsWith(prefix))) {
    return undefined
  }
  if (condition.uids?.length && (!event.actorId || !condition.uids.includes(event.actorId))) {
    return undefined
  }

  return regexMatch ? { regexMatch } : {}
}

function getRegex(pattern: string, cache: Map<string, RegExp | null>): RegExp | null {
  if (cache.has(pattern)) return cache.get(pattern) ?? null
  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  cache.set(pattern, compiled)
  return compiled
}

function readContent(event: TriggerEvent): string {
  const content = event.payload.content
  return typeof content === 'string' ? content : ''
}
