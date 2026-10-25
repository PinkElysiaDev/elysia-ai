import { describe, expect, it, vi } from 'vitest'
import type { DialogueResult, DialogueTask } from '@elysia-ai/core'
import {
  createPlatformSendTaskFromDialogue,
  HabitatSendRegistry,
  OutboundRouteRegistry,
  RouteMessageSender,
} from '../sender/index.js'

function task(overrides: Partial<DialogueTask> = {}): DialogueTask {
  return {
    lifeId: 'life-1',
    habitatId: 'group-1',
    scope: { type: 'habitat', key: 'group-1' },
    sourceStimulusIds: ['group-1:trigger:batcher:123'],
    mode: 'reply-now',
    messages: [],
    metadata: {
      routing: { platform: 'onebot', botId: 'bot-1', guildId: 'group-1', channelId: 'group-1' },
    },
    ...overrides,
  }
}

function result(content: string): DialogueResult {
  return { output: content, metadata: {} }
}

describe('合成触发刺激的发送链（habitat 回退）', () => {
  it('route 缺失时 task.metadata.routing 透传到发送目标，并经 HabitatSendRegistry 发出', async () => {
    const habitatSend = vi.fn().mockResolvedValue(undefined)
    const habitatRoutes = new HabitatSendRegistry()
    habitatRoutes.register({ platform: 'onebot', channelId: 'group-1', send: habitatSend })

    const sender = new RouteMessageSender(new OutboundRouteRegistry(), habitatRoutes)
    const sendTask = createPlatformSendTaskFromDialogue(task(), result('你好'))

    expect(sendTask.target.platform).toBe('onebot')
    expect(sendTask.target.channelId).toBe('group-1')

    await sender.send(sendTask)
    expect(habitatSend).toHaveBeenCalledWith('你好')
  })

  it('多段发言：options.content 优先于 result.output（每段独立发送）', async () => {
    const sendTask = createPlatformSendTaskFromDialogue(task(), result('第一段\n第二段'), undefined, {
      content: '第二段',
    })
    expect(sendTask.content).toBe('第二段')
  })

  it('route 命中时优先走入站路由（旧路径不变）', async () => {
    const routeSend = vi.fn().mockResolvedValue(undefined)
    const routes = new OutboundRouteRegistry()
    routes.remember({
      sourceStimulusId: 'msg-1',
      message: {
        id: 'msg-1', platform: 'onebot', botId: 'bot-1', channelId: 'group-1', userId: 'u1', content: 'hi',
      },
      send: routeSend,
    })
    const sender = new RouteMessageSender(routes)
    await sender.send(createPlatformSendTaskFromDialogue(
      task({ sourceStimulusIds: ['msg-1'] }),
      result('回复'),
    ))
    expect(routeSend).toHaveBeenCalledWith('回复')
  })

  it('route 与 habitat 均未命中时抛错（可观测失败而非静默丢失）', async () => {
    const sender = new RouteMessageSender(new OutboundRouteRegistry(), new HabitatSendRegistry())
    await expect(sender.send(createPlatformSendTaskFromDialogue(task(), result('x')))).rejects.toThrow(/Outbound route not found/)
  })

  it('HabitatSendRegistry：重复 habitat 刷新 LRU 位置，超容淘汰最旧', () => {
    const registry = new HabitatSendRegistry(2)
    const send1 = vi.fn()
    const send2 = vi.fn()
    const send3 = vi.fn()
    registry.register({ platform: 'onebot', channelId: 'a', send: send1 })
    registry.register({ platform: 'onebot', channelId: 'b', send: send2 })
    registry.register({ platform: 'onebot', channelId: 'a', send: send1 })  // 刷新 a
    registry.register({ platform: 'onebot', channelId: 'c', send: send3 })  // 淘汰 b
    expect(registry.resolve('onebot', 'a')).toBeDefined()
    expect(registry.resolve('onebot', 'b')).toBeUndefined()
    expect(registry.resolve('onebot', 'c')).toBeDefined()
    expect(registry.resolve('onebot', undefined)).toBeUndefined()
  })
})
