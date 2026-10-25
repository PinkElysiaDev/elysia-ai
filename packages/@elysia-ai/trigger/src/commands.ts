/**
 * 指令系统（第一层：零 LLM 成本）。
 *
 * vtuber 式别名指令：在群聊/私聊消息文本上做「长度优先」别名前缀匹配，
 * 不依赖指令前缀。核心语义：
 * - 无权限 / 冷却中不拦截——事件继续下行（模型看得见这条消息，能自己回应）；
 * - 执行结果作为 system.command.executed 系统事件写入事件清单（模型知情）；
 * - 签名缓存：配置不变不重建候选。
 */

import type { TriggerEvent } from './event.js'
import { expandTemplate } from './template.js'

/** 每 commandId 的 per-user 冷却记录容量上限（超限清最旧，防长期运行无界增长）。 */
const MAX_PER_USER_COOLDOWN_ENTRIES = 500

export interface CommandPermission {
  /** all：所有人；uids：白名单 */
  mode: 'all' | 'uids'
  uids?: string[]
}

export interface CommandAction {
  type: 'send-text'
  /** 回执模板：{{user}}/{{content}}(参数文本)/{{match.N}}/{{event.*}} 可用；空 = 不回复 */
  template: string
}

export interface CommandItem {
  id: string
  enabled: boolean
  /** 触发词别名（长度优先匹配，长别名在前防"点歌"抢先"点w歌"） */
  aliases: string[]
  permission: CommandPermission
  cooldown: {
    /** 全局冷却（毫秒）；0 = 不限 */
    globalMs: number
    /** 每人冷却（毫秒）；0 = 不限 */
    perUserMs: number
  }
  action: CommandAction
  /** 命中后写 system.command.executed 事件让模型知情（默认 true） */
  announceToFeed?: boolean
}

export interface CommandExecResult {
  commandId: string
  keyword: string
  /** 是否产生回执文本（模板为空则否） */
  receipt?: string
  announce: boolean
  /** 命中详情（供系统事件 payload） */
  ok: boolean
  message: string
}

export interface CommandSystemDeps {
  getConfig: () => CommandItem[]
  now?: () => number
}

interface AliasCandidate {
  item: CommandItem
  alias: string
}

/** 消息类事件（含可匹配文本的目录 key）。 */
const MATCHABLE_KEYS = new Set(['message', 'direct-message', 'mention', 'reply'])

/**
 * 回执渲染：统一模板引擎 expandTemplate 处理 {{user}}/{{match.N}}/{{event.*}}；
 * {{content}} 单独用别名后的参数文本（rest）——expandTemplate 会把它展开为
 * 完整原文（含别名前缀），与指令语义不符，故先摘出再回填。
 * rest 为空（无参指令）时回退为别名本身，与既有行为一致。
 */
function renderReceipt(template: string, event: TriggerEvent, rest: string, alias: string): string {
  const marker = '\u0000command-content\u0000'
  const masked = template.replace(/\{\{\s*content\s*\}\}/g, marker)
  return expandTemplate(masked, event)
    .split(marker)
    .join(rest !== '' ? rest : alias)
}

export class CommandSystem {
  private readonly deps: CommandSystemDeps
  private candidates: AliasCandidate[] = []
  private signature = ''
  private readonly globalLast = new Map<string, number>()
  private readonly userLast = new Map<string, Map<string, number>>()

  constructor(deps: CommandSystemDeps) {
    this.deps = deps
  }

  /**
   * 匹配并执行。返回 true = 事件被消费（不再进即时应对/合并器）；
   * false = 未命中或无权限/冷却中（事件下行，模型可见）。
   */
  handle(event: TriggerEvent, onExecuted: (result: CommandExecResult, event: TriggerEvent) => void): boolean {
    if (!MATCHABLE_KEYS.has(event.key)) return false
    const content = readContent(event).trim()
    if (content === '') return false

    const hit = this.match(content)
    if (!hit) return false
    const { item, alias, rest } = hit

    if (!passesPermission(item, event)) return false
    if (!this.passesCooldown(item, event)) return false
    this.markCooldown(item, event)

    const receipt = item.action.template !== ''
      ? renderReceipt(item.action.template, event, rest, alias)
      : undefined
    const result: CommandExecResult = {
      commandId: item.id,
      keyword: alias,
      receipt,
      announce: item.announceToFeed !== false,
      ok: true,
      message: receipt ?? '已执行',
    }
    onExecuted(result, event)
    return true
  }

  private match(content: string): { item: CommandItem, alias: string, rest: string } | undefined {
    this.refreshCandidates()
    for (const candidate of this.candidates) {
      if (!content.startsWith(candidate.alias)) continue
      const rest = content.slice(candidate.alias.length).trim()
      // 空参也算命中（无参指令），由模板决定回执
      return { item: candidate.item, alias: candidate.alias, rest }
    }
    return undefined
  }

  private refreshCandidates(): void {
    const items = this.deps.getConfig()
    const signature = JSON.stringify(items.map((item) => [item.id, item.enabled, item.aliases]))
    if (signature === this.signature) return
    this.signature = signature
    this.candidates = items
      .filter((item) => item.enabled && item.aliases.some((alias) => alias.trim() !== ''))
      .flatMap((item) => item.aliases
        .filter((alias) => alias.trim() !== '')
        .map((alias) => ({ item, alias: alias.trim() })))
      .sort((a, b) => b.alias.length - a.alias.length)
  }

  private passesCooldown(item: CommandItem, event: TriggerEvent): boolean {
    const now = this.now()
    if (item.cooldown.globalMs > 0) {
      const last = this.globalLast.get(item.id) ?? 0
      if (now - last < item.cooldown.globalMs) return false
    }
    if (item.cooldown.perUserMs > 0 && event.actorId) {
      const last = this.userLast.get(item.id)?.get(event.actorId) ?? 0
      if (now - last < item.cooldown.perUserMs) return false
    }
    return true
  }

  private markCooldown(item: CommandItem, event: TriggerEvent): void {
    const now = this.now()
    if (item.cooldown.globalMs > 0) this.globalLast.set(item.id, now)
    if (item.cooldown.perUserMs > 0 && event.actorId) {
      const perItem = this.userLast.get(item.id) ?? new Map<string, number>()
      perItem.set(event.actorId, now)
      // 容量上限：超 500 条清最旧（Map 迭代序 = 插入序，删首键）。
      while (perItem.size > MAX_PER_USER_COOLDOWN_ENTRIES) {
        const oldest = perItem.keys().next().value
        if (oldest === undefined) break
        perItem.delete(oldest)
      }
      this.userLast.set(item.id, perItem)
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function passesPermission(item: CommandItem, event: TriggerEvent): boolean {
  if (item.permission.mode === 'all') return true
  if (!event.actorId) return false
  return (item.permission.uids ?? []).includes(event.actorId)
}

function readContent(event: TriggerEvent): string {
  const content = event.payload.content
  return typeof content === 'string' ? content : ''
}
