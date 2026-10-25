import type { Session } from 'koishi'
import type { PlatformMessage } from '../../types/index.js'

interface ElementLike {
  type: string
  attrs?: Record<string, unknown> | undefined
  children?: ElementLike[] | undefined
}

/**
 * Koishi 元素 → 纯文本片段（P1-14）。
 *
 * - text：取 attrs.content
 * - at：渲染为 @name（无 name 时 @id），保持自然语序
 * - quote：不注入正文（避免引用内容重复污染感知/LLM），由调用方单独提取
 * - 其余标记（image/file 等）：无文本贡献，子元素继续递归
 */
export function elementToPlainText(element: ElementLike): string {
  if (element.type === 'text') {
    return String(element.attrs?.content ?? '')
  }
  if (element.type === 'at') {
    const attrs = element.attrs ?? {}
    const name = typeof attrs.name === 'string' && attrs.name !== '' ? attrs.name : attrs.id
    return name !== undefined && name !== '' ? `@${name}` : '@'
  }
  if (element.type === 'quote') return ''
  if (Array.isArray(element.children)) {
    return element.children.map(elementToPlainText).join('')
  }
  return ''
}

function extractQuoteContent(elements: ElementLike[]): string | undefined {
  for (const element of elements) {
    if (element.type === 'quote' && Array.isArray(element.children)) {
      const text = element.children.map(elementToPlainText).join('').trim()
      if (text !== '') return text
    }
  }
  return undefined
}

/**
 * 将 Koishi session 转换为 PlatformMessage
 *
 * @param session Koishi 会话对象
 * @returns 平台无关的消息格式
 */
export function sessionToPlatformMessage(session: Session): PlatformMessage {
  const quote = (session.quote as { id?: string } | undefined) ?? undefined
  const elements = (Array.isArray(session.elements) ? session.elements : undefined) as ElementLike[] | undefined

  // 仅当 at 元素指向本 bot（selfId）时才算“提及本 bot”。
  // 旧实现只检测是否存在任意 at 元素，导致 @他人 也被误判为提及本 bot。
  const selfId = session.selfId ? String(session.selfId) : undefined
  const atElements = elements?.filter((element) => element.type === 'at') ?? []
  const mentionedUserIds = atElements
    .map((element) => {
      const id = (element.attrs as { id?: unknown } | undefined)?.id
      return id !== undefined && id !== null ? String(id) : ''
    })
    .filter((id) => id !== '')
  const isMentioned = selfId !== undefined && atElements.some(
    (element) => String((element.attrs as { id?: unknown } | undefined)?.id ?? '') === selfId,
  )

  const rawContent = session.content ?? ''
  // 纯文本化：<at id="x"/> 你好 → @x 你好；<quote/> 内容单独存放，
  // 避免元素标记原文流入感知正则、问句检测与 LLM（P1-14）。
  const content = elements ? elements.map(elementToPlainText).join('') : rawContent

  return {
    id: String(session.messageId ?? session.id),
    platform: session.platform,
    botId: session.selfId ?? '',
    guildId: session.guildId,
    channelId: session.channelId,
    userId: session.userId,
    username: session.username || session.event?.user?.name,
    content,
    rawContent,
    timestamp: session.timestamp,
    replyToMessageId: quote?.id ? String(quote.id) : undefined,
    quoteContent: elements ? extractQuoteContent(elements) : undefined,
    mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
    isDirectMessage: !session.guildId,
    isMentioned,
  }
}
