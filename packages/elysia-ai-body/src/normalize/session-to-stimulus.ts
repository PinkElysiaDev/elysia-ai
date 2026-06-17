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
    },
    metadata: {
      contentText: message.content ?? '',
    },
  }
}

/**
 * @deprecated 请使用 platformMessageToStimulus()
 *
 * 此函数已被重命名为 platformMessageToStimulus，名称更准确地反映了
 * 输入来源（PlatformMessage，而非 Session）和转换方向。
 *
 * 保留此别名是为了向后兼容，将在未来版本中移除。
 */
export const sessionToStimulus = platformMessageToStimulus
