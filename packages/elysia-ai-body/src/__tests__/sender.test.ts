import { describe, expect, it, vi } from 'vitest'
import type { DialogueResult, DialogueTask } from '@elysia-ai/core'
import {
  createPlatformSendTaskFromDialogue,
  OutboundRouteRegistry,
  RouteMessageSender,
} from '../sender/index.js'

function createDialogueTask(): DialogueTask {
  return {
    scope: { type: 'user', key: 'user-1' },
    sourceStimulusIds: ['stimulus-1'],
    mode: 'reply-now',
    messages: [],
    metadata: {},
  }
}

function createDialogueResult(): DialogueResult {
  return {
    taskId: 'stimulus-1',
    output: 'hello from elysia',
    messages: [],
    metadata: {},
  }
}

describe('body sender', () => {
  it('creates platform send task from dialogue result and outbound route', () => {
    const task = createDialogueTask()
    const result = createDialogueResult()

    const sendTask = createPlatformSendTaskFromDialogue(task, result, {
      sourceStimulusId: 'stimulus-1',
      message: {
        id: 'message-1',
        platform: 'qq',
        botId: 'bot-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
      },
      send: async () => {},
    })

    expect(sendTask.content).toBe('hello from elysia')
    expect(sendTask.target.platform).toBe('qq')
    expect(sendTask.target.channelId).toBe('channel-1')
    expect(sendTask.target.sourceStimulusId).toBe('stimulus-1')
    expect(sendTask.metadata?.['sourceMessageId']).toBe('message-1')
  })

  it('keeps only the latest outbound routes within maxRoutes', () => {
    const registry = new OutboundRouteRegistry(1)

    registry.remember({
      sourceStimulusId: 'stimulus-1',
      message: { id: 'message-1', platform: 'qq', botId: 'bot-1' },
      send: async () => {},
    })

    registry.remember({
      sourceStimulusId: 'stimulus-2',
      message: { id: 'message-2', platform: 'qq', botId: 'bot-1' },
      send: async () => {},
    })

    expect(registry.get('stimulus-1')).toBeUndefined()
    expect(registry.get('stimulus-2')).toBeDefined()
  })

  it('sends through the route matched by source stimulus id', async () => {
    const registry = new OutboundRouteRegistry()
    const send = vi.fn()

    registry.remember({
      sourceStimulusId: 'stimulus-1',
      message: { id: 'message-1', platform: 'qq', botId: 'bot-1' },
      send,
    })

    const sender = new RouteMessageSender(registry)
    const sendTask = createPlatformSendTaskFromDialogue(
      createDialogueTask(),
      createDialogueResult(),
      registry.get('stimulus-1')
    )

    await sender.send(sendTask)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('hello from elysia')
  })

  it('fails when no outbound route can be found', async () => {
    const sender = new RouteMessageSender(new OutboundRouteRegistry())
    const sendTask = createPlatformSendTaskFromDialogue(
      createDialogueTask(),
      createDialogueResult()
    )

    await expect(sender.send(sendTask)).rejects.toThrow(
      'Outbound route not found for stimulus "stimulus-1"'
    )
  })
})
