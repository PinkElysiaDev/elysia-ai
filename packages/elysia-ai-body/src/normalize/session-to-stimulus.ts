import type { PlatformMessage } from '../types/index.js'
import type { Stimulus } from '@elysia-ai/core'

/**
 * 将 PlatformMessage 转换为 Stimulus
 *
 * 这是 body 层中**唯一**负责 PlatformMessage → Stimulus 转换的函数。
 * 所有平台适配器（KoishiBodyAdapter 等）和 handlePlatformMessage 都必须
 * 通过此函数构造 Stimulus，禁止在其他地方内联构造。
 *
 * habitatId 选取优先级：
 *   guildId（群）> channelId（频道）> userId（私聊）> 'unknown'
 *
 * 设计说明：
 * - type 固定为 'utterance'（用户主动发言）
 * - 结构化平台字段提升为 Stimulus 正式字段
 * - 仍保留 payload 作为扩展信息容器
 *
 * @param message 平台无关的消息对象
 * @returns 系统内部使用的 Stimulus 对象
 */
export function platformMessageToStimulus(message: PlatformMessage): Stimulus {
  const habitatId =
    message.guildId ?? message.channelId ?? message.userId ?? 'unknown'

  return {
    id: message.id,
    type: 'utterance',
    timestamp: message.timestamp ?? Date.now(),

    habitatId,
    actorId: message.userId,
    threadId: message.replyToMessageId,
    targetId: message.botId || undefined,

    platform: message.platform,
    botId: message.botId,
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    replyToMessageId: message.replyToMessageId,

    isDirectMessage: message.isDirectMessage,
    isMentioned: message.isMentioned,
    isReply: Boolean(message.replyToMessageId),
    isSystemEvent: false,

    payload: {
      content: message.content ?? '',
      rawContent: message.rawContent,
      quoteContent: message.quoteContent,
      mentionedUserIds: message.mentionedUserIds,
      actorName: message.username,
    },
    metadata: {
      contentText: message.content ?? '',
    },
  }
}

/**
 * 平台事件（非消息类）→ Stimulus 的构造入口。
 *
 * 与 platformMessageToStimulus 并列的第二个（也是最后一个）合法构造点：
 * 群成员增减 / 表情回应 / bot 自身输出等平台事件经此归一为
 * appearance / reaction / system 型刺激，payload.eventKind 携带目录事件类型，
 * 由 trigger 库的 stimulusToTriggerEvent 派生为目录事件。
 */
export type PlatformEventKind = 'member-added' | 'member-removed' | 'reaction' | 'bot-sent'

export interface PlatformEventInput {
  eventKind: PlatformEventKind
  platform?: string
  botId?: string
  guildId?: string
  channelId?: string
  userId?: string
  /** 发起者展示名（feed 行渲染） */
  userName?: string
  /** 消息型事件的内容（bot-sent 的发言文本等） */
  content?: string
  timestamp?: number
  extra?: Record<string, unknown>
}

export function platformEventToStimulus(input: PlatformEventInput): Stimulus {
  const timestamp = input.timestamp ?? Date.now()
  const habitatId = input.guildId ?? input.channelId ?? input.userId ?? 'unknown'
  const type: Stimulus['type'] = input.eventKind === 'bot-sent'
    ? 'system'
    : input.eventKind === 'reaction'
      ? 'reaction'
      : 'appearance'
  const scope = input.channelId ?? input.guildId ?? input.userId ?? 'unknown'

  return {
    id: `${input.eventKind}:${input.platform ?? '?'}:${scope}:${input.userId ?? '?'}:${timestamp}`,
    type,
    timestamp,
    habitatId,
    actorId: input.eventKind === 'bot-sent' ? input.botId : input.userId,
    targetId: input.botId,
    platform: input.platform,
    botId: input.botId,
    guildId: input.guildId,
    channelId: input.channelId,
    isSystemEvent: type === 'system',
    payload: {
      eventKind: input.eventKind,
      content: input.content,
      actorName: input.userName,
      ...input.extra,
    },
    metadata: {
      eventKind: input.eventKind,
      actorName: input.userName,
    },
  }
}

