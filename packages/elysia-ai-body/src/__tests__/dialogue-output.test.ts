import { describe, expect, it, vi } from 'vitest'
import { createDefaultRuntime } from 'koishi-plugin-elysia-ai-runtime'
import { apply } from '../index.js'

function createContext(runtime: ReturnType<typeof createDefaultRuntime>) {
  const messageHandlers: Array<(session: any) => Promise<void> | void> = []
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia-ai-runtime': runtime,
    logger() {
      return {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      }
    },
    on(event: string, handler: (...args: any[]) => any) {
      if (event === 'message') {
        messageHandlers.push(handler)
      }
      if (event === 'dispose') {
        disposeHandlers.push(handler)
      }
      return () => {}
    },
    async receiveMessage(session: any) {
      for (const handler of messageHandlers) {
        await handler(session)
      }
    },
    dispose() {
      for (const handler of disposeHandlers) {
        handler()
      }
    },
  }

  return ctx
}

describe('elysia-ai-body dialogue output', () => {
  it('sends dialogue.output.created output through the remembered inbound route', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    const ctx = createContext(runtime)
    const send = vi.fn()

    apply(ctx, {})

    await ctx.receiveMessage({
      messageId: 'stimulus-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      content: 'hello',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const senderCompleted = vi.fn()
    runtime.context.eventBus.on('sender.completed', senderCompleted)

    const task = {
      scope: { type: 'user' as const, key: 'user-1' },
      sourceStimulusIds: ['stimulus-1'],
      mode: 'reply-now' as const,
      messages: [],
      metadata: {},
    }
    const result = {
      taskId: 'stimulus-1',
      output: 'elysia reply',
      messages: [],
      metadata: {},
    }

    await runtime.context.eventBus.emit('dialogue.output.created', {
      outputId: 'output-1',
      stimulusId: 'stimulus-1',
      content: result.output,
      task,
      result,
      messages: result.messages,
      metadata: {},
    })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('elysia reply')
    expect(senderCompleted).toHaveBeenCalledOnce()
    expect(senderCompleted.mock.calls[0][0].task.target.channelId).toBe('channel-1')
  })

  it('does not send non-reply dialogue results', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    const ctx = createContext(runtime)
    const send = vi.fn()

    apply(ctx, {})

    await ctx.receiveMessage({
      messageId: 'stimulus-1',
      id: 'session-1',
      platform: 'qq',
      selfId: 'bot-1',
      channelId: 'channel-1',
      userId: 'user-1',
      content: 'hello',
      timestamp: Date.now(),
      elements: [],
      send,
    })

    const task = {
      scope: { type: 'user' as const, key: 'user-1' },
      sourceStimulusIds: ['stimulus-1'],
      mode: 'silent-update' as const,
      messages: [],
      metadata: {},
    }
    const result = {
      taskId: 'stimulus-1',
      output: 'should not send',
      messages: [],
      metadata: {},
    }

    await runtime.context.eventBus.emit('dialogue.output.created', {
      outputId: 'output-1',
      stimulusId: 'stimulus-1',
      content: result.output,
      task,
      result,
      messages: result.messages,
      metadata: {},
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('emits sender.failed when the outbound route is missing', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    const ctx = createContext(runtime)
    const senderFailed = vi.fn()

    apply(ctx, {})
    runtime.context.eventBus.on('sender.failed', senderFailed)

    const task = {
      scope: { type: 'user' as const, key: 'user-1' },
      sourceStimulusIds: ['missing-stimulus'],
      mode: 'reply-now' as const,
      messages: [],
      metadata: {},
    }
    const result = {
      taskId: 'missing-stimulus',
      output: 'cannot route',
      messages: [],
      metadata: {},
    }

    await runtime.context.eventBus.emit('dialogue.output.created', {
      outputId: 'output-missing',
      stimulusId: 'missing-stimulus',
      content: result.output,
      task,
      result,
      messages: result.messages,
      metadata: {},
    })

    expect(senderFailed).toHaveBeenCalledOnce()
    expect(senderFailed.mock.calls[0][0].task.target.sourceStimulusId).toBe('missing-stimulus')
  })
})
