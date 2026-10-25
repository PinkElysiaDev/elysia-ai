/**
 * 唤醒元工具：send_reply / stay_silent / get_event_history。
 *
 * 参照 vtuber 的元工具设计：
 * - send_reply 是输出协议（segments 分通道；v1 纯文本）；
 * - stay_silent 是零副作用信号工具——决策由 resolveOutput 判定，
 *   保证行为循环永远有确定出口（显式沉默 / 有输出 / 默认沉默三态兜底）；
 * - get_event_history 让模型按需回看历史 events pack（分页/条数限制）。
 */

import type { BrainToolEntry } from '@elysia-ai/brain'
import type { EventsPackEntry } from '@elysia-ai/trigger'

export interface WakeToolState {
  /** send_reply 收集的输出段（按调用顺序） */
  segments: string[]
  /** stay_silent 决策（最后一次调用生效） */
  silent: { chosen: boolean; reason?: string }
}

export interface WakeToolDeps {
  state: WakeToolState
  /** 历史 pack 拉取（behavior 的 EventsPackMemory） */
  getRecentPacks: (limit?: number) => EventsPackEntry[]
  renderPack: (entry: EventsPackEntry) => string
  /** 贴表情回调（平台侧执行）；提供时才注册 add_reaction 工具 */
  addReaction?: (messageId: string, emojiId: string) => Promise<boolean>
  /** 最近事件（非 message 事件的补充信息源） */
  lastEvent?: import('@elysia-ai/core').TriggerEvent
  /**
   * 最近一条 message 组事件（message/mention/reply/direct-message）的
   * stimulusId：add_reaction 省略 message_id 时的缺省目标。
   * 不直接用 lastEvent.stimulusId——reaction/member 等事件的合成 id
   * 传给平台必失败。
   */
  recentMessageId?: string
}

const DEFAULT_DIRECTIVE = '你是群聊中的 AI 生命体。每次唤醒时你会看到最近的事件清单，请基于它决定如何回应：调用 send_reply 发言（可多次），或调用 stay_silent 保持沉默。不要强行找话，也不要重复自己说过的话。'

export const WAKE_TOOLS_SYSTEM_HINT = DEFAULT_DIRECTIVE

/** W2-15：send_reply 输出防护上限（段数 / 单段字符数）。 */
export const MAX_SEND_REPLY_SEGMENTS = 5
export const MAX_SEND_REPLY_TEXT_LENGTH = 2000

export function createWakeToolState(): WakeToolState {
  return { segments: [], silent: { chosen: false } }
}

export function createWakeTools(deps: WakeToolDeps): BrainToolEntry[] {
  const tools: BrainToolEntry[] = [
    {
      definition: {
        name: 'send_reply',
        description: '发送一条聊天消息（发言）。可多次调用以发送多条。后调用的决策覆盖先前的：先 stay_silent 后 send_reply 会正常发言，反之则保持沉默。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要发送的消息文本' },
          },
          required: ['text'],
        },
      },
      async execute(args) {
        const text = typeof args.text === 'string' ? args.text.trim() : ''
        if (!text) {
          return { ok: false, code: 'empty-text', message: 'text must be a non-empty string' }
        }
        // W2-15：段数上限——超过 5 条发言拒绝追加（防工具循环失控刷屏）。
        if (deps.state.segments.length >= MAX_SEND_REPLY_SEGMENTS) {
          return { ok: false, code: 'too-many-segments', message: `最多 ${MAX_SEND_REPLY_SEGMENTS} 条发言` }
        }
        // W2-15：单段长度上限——超 2000 字符截断到 2000 并附省略号（仍发送）。
        const bounded = text.length > MAX_SEND_REPLY_TEXT_LENGTH
          ? `${text.slice(0, MAX_SEND_REPLY_TEXT_LENGTH)}……`
          : text
        // last-call-wins：发言撤销先前的沉默决策（反之亦然），模型可在多轮间改主意
        deps.state.silent = { chosen: false }
        deps.state.segments.push(bounded)
        return { ok: true, sent: 1 }
      },
    },
    {
      definition: {
        name: 'stay_silent',
        description: '保持沉默（不发送任何消息）。当前无需回应时选择它，附上简短理由。',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: '沉默理由（简短）' },
          },
          required: ['reason'],
        },
      },
      async execute(args) {
        const reason = typeof args.reason === 'string' ? args.reason : ''
        deps.state.silent = { chosen: true, reason }
        return { ok: true, silent: true, reason }
      },
    },
    {
      definition: {
        name: 'get_event_history',
        description: '回看最近几次触发唤醒时的 events pack（当时的群聊事件快照），用于回忆更早发生了什么。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回最近 N 次触发（1-10，默认 3）' },
          },
        },
      },
      async execute(args) {
        const rawLimit = typeof args.limit === 'number' ? args.limit : 3
        const limit = Math.max(1, Math.min(10, Math.floor(rawLimit)))
        const packs = deps.getRecentPacks(limit)
        if (!packs.length) return { ok: true, packs: [], message: '暂无历史触发记录' }
        return { ok: true, packs: packs.map((entry) => deps.renderPack(entry)) }
      },
    },
  ]

  // 贴表情回应（可选工具：wrapper 注入平台回调时才可用）
  if (deps.addReaction) {
    tools.push({
      definition: {
        name: 'add_reaction',
        description: '给一条消息贴表情回应（QQ 群聊）。省略 message_id 时回应事件清单中最近的一条消息；emoji_id 填 QQ 表情 id（如 "76"）或 emoji 字符。适合在不想发整条消息时做轻量互动。',
        parameters: {
          type: 'object',
          properties: {
            message_id: { type: 'string', description: '目标消息 id（缺省 = 最近一条事件消息）' },
            emoji_id: { type: 'string', description: '表情 id 或 emoji 字符' },
          },
          required: ['emoji_id'],
        },
      },
      async execute(args) {
        const emojiId = typeof args.emoji_id === 'string' ? args.emoji_id.trim() : ''
        if (!emojiId) {
          return { ok: false, code: 'empty-emoji', message: 'emoji_id must be a non-empty string' }
        }
        const messageId = typeof args.message_id === 'string' && args.message_id !== ''
          ? args.message_id
          : deps.recentMessageId
        if (!messageId) {
          return { ok: false, code: 'no-target', message: 'no message_id given and no recent message available' }
        }
        try {
          const reacted = await deps.addReaction!(messageId, emojiId)
          return reacted
            ? { ok: true, reacted: messageId, emoji: emojiId }
            : { ok: false, code: 'reaction-failed', message: 'platform rejected the reaction' }
        } catch (error) {
          return { ok: false, code: 'reaction-error', message: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  }

  return tools
}

/**
 * 从工具循环结果导出输出段与沉默决策（三态兜底）：
 * ① 显式 stay_silent → 沉默（记理由）；
 * ② 否则有 send_reply 输出段 → 发言；
 * ③ 都没有 → 默认沉默（记排查理由）。
 */
export function resolveWakeOutput(
  state: WakeToolState,
  loop: import('@elysia-ai/brain').ToolLoopResult,
): { segments: string[]; silent: boolean; silentReason?: string } {
  if (state.silent.chosen) {
    return { segments: [], silent: true, silentReason: state.silent.reason || 'stay_silent' }
  }
  if (state.segments.length > 0) {
    return { segments: [...state.segments], silent: false }
  }
  return {
    segments: [],
    silent: true,
    silentReason: loop.stopReason === 'max-rounds'
      ? `模型达到工具调用轮次上限（${loop.rounds} 轮）未输出`
      : '模型未调用任何输出工具',
  }
}
