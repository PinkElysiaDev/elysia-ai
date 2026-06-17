/**
 * R1 回归：isMentioned 必须比对 selfId（M9）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md，M9）：
 * 旧实现 `elements.some(e => e.type === 'at')` 只检测是否存在任意 at 元素，
 * 导致 @他人 也被误判为“提及本 bot”，会错误触发寻址类响应。
 */

import { describe, it, expect } from 'vitest'
import { sessionToPlatformMessage } from '../packages/elysia-ai-body/src/adapters/koishi/session-to-platform-message.js'

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-1',
    id: 'session-id',
    platform: 'qq',
    selfId: 'bot-001',
    guildId: 'guild-123',
    channelId: 'channel-456',
    userId: 'user-789',
    content: 'hi',
    timestamp: 1700000000000,
    ...overrides,
  } as unknown as import('koishi').Session
}

describe('R1 isMentioned 比对 selfId', () => {
  it('@本 bot 时 isMentioned 为 true', () => {
    const session = makeSession({
      elements: [{ type: 'at', attrs: { id: 'bot-001' } }],
    })
    expect(sessionToPlatformMessage(session).isMentioned).toBe(true)
  })

  it('@他人 时 isMentioned 为 false', () => {
    const session = makeSession({
      elements: [{ type: 'at', attrs: { id: 'someone-else' } }],
    })
    expect(sessionToPlatformMessage(session).isMentioned).toBe(false)
  })

  it('无 at 元素时 isMentioned 为 false', () => {
    const session = makeSession({
      elements: [{ type: 'text', attrs: { content: 'hi' } }],
    })
    expect(sessionToPlatformMessage(session).isMentioned).toBe(false)
  })

  it('多个 at 中含本 bot 时 isMentioned 为 true', () => {
    const session = makeSession({
      elements: [
        { type: 'at', attrs: { id: 'someone-else' } },
        { type: 'at', attrs: { id: 'bot-001' } },
      ],
    })
    expect(sessionToPlatformMessage(session).isMentioned).toBe(true)
  })
})
