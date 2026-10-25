export interface PlatformMessage {
  id: string
  platform: string
  botId: string
  guildId?: string
  channelId?: string
  userId?: string
  /** 发送者展示名（feed 行渲染用）。 */
  username?: string
  /** 纯文本内容：已剥离 Koishi 元素标记（<at/>、<quote/> 等）。 */
  content?: string
  /** 原始 Koishi 元素化文本（调试/审计用）。 */
  rawContent?: string
  timestamp?: number
  replyToMessageId?: string
  /** 被引用消息的纯文本内容。 */
  quoteContent?: string
  /** 消息中 @ 的全部用户 id（含本 bot）。 */
  mentionedUserIds?: string[]
  isDirectMessage?: boolean
  isMentioned?: boolean
}
