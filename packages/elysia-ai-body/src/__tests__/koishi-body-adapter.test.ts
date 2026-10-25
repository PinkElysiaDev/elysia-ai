import { describe, it, expect, vi } from 'vitest'
import { KoishiBodyAdapter } from '../adapters/koishi/koishi-body-adapter.js'
import { createDefaultRuntime } from 'koishi-plugin-elysia-ai-runtime'

// 自消息处理（P0-1 语义演进）：OneBot 等适配器会把 bot 自己发出的
// message_sent 也派发为 'message' 事件。触发器重构后，自身消息不再作为
// utterance 刺激进入主链（防自回复死循环），而是归一为 bot-sent 系统事件
// 刺激（feed-only：模型自我认知来源，system 组不参与密度合并）。

function createMessageCapturingContext() {
  let messageHandler: ((session: unknown) => Promise<void>) | undefined
  const ctx: any = {
    logger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    on(event: string, handler: (session: unknown) => Promise<void>) {
      if (event === 'message') messageHandler = handler
      return () => {}
    },
  }
  return {
    ctx,
    dispatch: (session: unknown) => {
      if (!messageHandler) throw new Error('message listener not registered')
      return messageHandler(session)
    },
  }
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'm1',
    platform: 'onebot',
    selfId: 'bot-1',
    channelId: 'c1',
    userId: 'u1',
    content: 'hi',
    timestamp: 1700000000000,
    ...overrides,
  }
}

describe('KoishiBodyAdapter self-message handling', () => {
  it('bot 自身消息产生 bot-sent 系统刺激注入 runtime（feed-only，无循环）', async () => {
    const { ctx, dispatch } = createMessageCapturingContext()
    const runtime = createDefaultRuntime()
    const spy = vi.spyOn(runtime, 'receiveStimulus')
    const adapter = new KoishiBodyAdapter(ctx, runtime)
    adapter.registerListeners()

    await dispatch(makeSession({ userId: 'bot-1', messageId: 'self-msg', content: '我的发言' }))

    expect(spy).toHaveBeenCalledOnce()
    const stimulus = spy.mock.calls[0][0]
    expect(stimulus.type).toBe('system')
    expect(stimulus.payload.eventKind).toBe('bot-sent')
    expect(stimulus.actorId).toBe('bot-1')
    expect(stimulus.payload.content).toBe('我的发言')
  })

  it('recordBotSent: false 时忽略 bot 自身消息，不注入 runtime（旧行为）', async () => {
    const { ctx, dispatch } = createMessageCapturingContext()
    const runtime = createDefaultRuntime()
    const spy = vi.spyOn(runtime, 'receiveStimulus')
    const adapter = new KoishiBodyAdapter(ctx, runtime, { recordBotSent: false })
    adapter.registerListeners()

    await dispatch(makeSession({ userId: 'bot-1', messageId: 'self-msg' }))

    expect(spy).not.toHaveBeenCalled()
  })

  it('正常用户消息仍会注入 runtime', async () => {
    const { ctx, dispatch } = createMessageCapturingContext()
    const runtime = createDefaultRuntime()
    const spy = vi.spyOn(runtime, 'receiveStimulus')
    const adapter = new KoishiBodyAdapter(ctx, runtime)
    adapter.registerListeners()

    await dispatch(makeSession({ userId: 'user-9', messageId: 'user-msg' }))

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0].id).toBe('user-msg')
    expect(spy.mock.calls[0][0].type).toBe('utterance')
  })
})
