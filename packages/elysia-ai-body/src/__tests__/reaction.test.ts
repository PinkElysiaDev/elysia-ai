import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'koishi'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import type { TriggerEvent } from '@elysia-ai/core'
import { KoishiBodyAdapter } from '../adapters/koishi/koishi-body-adapter.js'

/** reaction 双向测试：接收桥接（防御性 notice 归一）+ add_reaction 工具契约。 */

function mockAdapter() {
  const received: unknown[] = []
  const listeners = new Map<string, (session: unknown) => unknown>()
  const ctx = {
    logger: () => ({ info() {}, debug() {}, warn() {}, error() {} }),
    on: (event: string, listener: (session: unknown) => unknown) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  } as unknown as Context
  const runtime = {
    receiveStimulus: (stimulus: unknown) => {
      received.push(stimulus)
      return Promise.resolve()
    },
  } as unknown as Runtime
  const adapter = new KoishiBodyAdapter(ctx, runtime)
  adapter.registerListeners()
  return { listeners, received }
}

describe('reaction 接收桥接（防御性）', () => {
  it('group-msg-emoji-like 归一为 reaction 刺激（含 emoji/count/messageId）', async () => {
    const { listeners, received } = mockAdapter()
    const handler = listeners.get('notice')!
    await handler({
      subtype: 'group-msg-emoji-like',
      platform: 'onebot',
      selfId: 'bot1',
      onebot: {
        group_id: 12345,
        user_id: 67890,
        message_id: 'msg-abc',
        likes: [{ emoji_id: '76', count: 2 }],
      },
    })
    expect(received).toHaveLength(1)
    const stimulus = received[0] as Record<string, unknown>
    expect(stimulus['type']).toBe('reaction')
    expect(stimulus['habitatId']).toBe('12345')
    expect(stimulus['actorId']).toBe('67890')
    expect(stimulus['payload']).toMatchObject({
      eventKind: 'reaction',
      emoji: '76',
      count: 2,
      messageId: 'msg-abc',
    })
  })

  it('onebot/message-reactions-updated（频道场景）同样归一', async () => {
    const { listeners, received } = mockAdapter()
    const handler = listeners.get('onebot')!
    await handler({
      subtype: 'message-reactions-updated',
      platform: 'onebot',
      selfId: 'bot1',
      event: { _data: { guild_id: 'g-1', channel_id: 'c-1', user_id: 'u-1', message_id: 'm-1', reaction: { emoji_id: '😄', count: 1 } } },
    })
    const stimulus = received[0] as Record<string, unknown>
    expect(stimulus['payload']).toMatchObject({ eventKind: 'reaction', emoji: '😄' })
  })

  it('无关 subtype（poke 等）与缺目标的通知被忽略', async () => {
    const { listeners, received } = mockAdapter()
    const handler = listeners.get('notice')!
    await handler({ subtype: 'poke', platform: 'onebot', onebot: { group_id: 1 } })
    await handler({ subtype: 'group-msg-emoji-like', platform: 'onebot' })  // 无 group/channel
    await handler(undefined)
    expect(received).toHaveLength(0)
  })
})

describe('add_reaction 工具契约', () => {
  it('省略 message_id 时用最近 message 组事件 id（非 lastEvent 合成 id）；emoji 必填；回调异常返回结构化错误', async () => {
    const { createWakeTools, createWakeToolState } = await import('../../../@elysia-ai/behavior/src/tools.js')
    // lastEvent 是 reaction 事件：其合成 stimulusId 不能作为平台目标（E21 修复点）。
    const lastEvent: TriggerEvent = {
      key: 'reaction',
      timestamp: Date.now(),
      habitatId: 'g1',
      actorId: 'u1',
      stimulusId: 'reaction:g1:synthetic',
      payload: { emoji: '76' },
    }
    const calls: Array<[string, string]> = []
    const state = createWakeToolState()
    const tools = createWakeTools({
      state,
      getRecentPacks: () => [],
      renderPack: () => '',
      lastEvent,
      recentMessageId: 'platform-msg-42',
      addReaction: async (messageId, emojiId) => {
        calls.push([messageId, emojiId])
        if (emojiId === 'boom') throw new Error('platform down')
        return emojiId !== 'reject'
      },
    })

    const addReaction = tools.find((tool) => tool.definition.name === 'add_reaction')
    expect(addReaction).toBeDefined()

    // 缺省 message_id → 最近 message 组事件 id（而非 lastEvent.stimulusId）
    expect(await addReaction!.execute({ emoji_id: '76' })).toMatchObject({ ok: true, reacted: 'platform-msg-42', emoji: '76' })
    expect(calls[0]).toEqual(['platform-msg-42', '76'])
    // 显式 message_id
    expect(await addReaction!.execute({ message_id: 'm-9', emoji_id: '😄' })).toMatchObject({ ok: true, reacted: 'm-9' })
    // 无 recentMessageId 可回退时（重建工具）报 no-target
    const toolsWithoutRecent = createWakeTools({
      state: createWakeToolState(),
      getRecentPacks: () => [],
      renderPack: () => '',
      lastEvent,
      addReaction: async () => true,
    })
    const addReactionNoRecent = toolsWithoutRecent.find((tool) => tool.definition.name === 'add_reaction')
    expect(await addReactionNoRecent!.execute({ emoji_id: '76' })).toMatchObject({ ok: false, code: 'no-target' })
    // 空 emoji / 平台拒绝 / 异常
    expect(await addReaction!.execute({ emoji_id: '' })).toMatchObject({ ok: false, code: 'empty-emoji' })
    expect(await addReaction!.execute({ emoji_id: 'reject' })).toMatchObject({ ok: false, code: 'reaction-failed' })
    expect(await addReaction!.execute({ emoji_id: 'boom' })).toMatchObject({ ok: false, code: 'reaction-error' })
  })

  it('未提供 addReaction 回调时不注册该工具', async () => {
    const { createWakeTools, createWakeToolState } = await import('../../../@elysia-ai/behavior/src/tools.js')
    const tools = createWakeTools({
      state: createWakeToolState(),
      getRecentPacks: () => [],
      renderPack: () => '',
    })
    expect(tools.find((tool) => tool.definition.name === 'add_reaction')).toBeUndefined()
    expect(tools.find((tool) => tool.definition.name === 'send_reply')).toBeDefined()
    vi.unstubAllGlobals()
  })
})
