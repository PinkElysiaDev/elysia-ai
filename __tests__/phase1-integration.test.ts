/**
 * Phase 1 集成测试
 * 
 * 验证以下完整链路：
 * 1. createDefaultRuntime() → start() → loadManifest()
 * 2. handlePlatformMessage() → receiveStimulus()
 * 3. stimulus.received 事件正确触发
 * 4. lifeRegistry 中有注册的 life
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { handlePlatformMessage } from '../packages/elysia-ai-body/src/index.js'
import { parseManifest } from '../packages/elysia-ai-runtime/src/manifest/loader.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'

let runtime: Runtime

beforeEach(async () => {
  runtime = createDefaultRuntime()
  await runtime.start()
})

afterEach(async () => {
  if (runtime.getState() === 'running') {
    await runtime.stop()
  }
})

describe('Phase 1 完整链路集成测试', () => {

  describe('Runtime 启动与 Manifest 加载', () => {
    it('runtime 启动后应处于 running 状态', () => {
      expect(runtime.getState()).toBe('running')
    })

    it('加载 manifest 后生命体应注册到 registry', async () => {
      await runtime.loadManifest({
        version: '1.0',
        lifeInstances: [
          { id: 'elysia-main', type: 'elysia-default' },
        ],
      })

      const life = runtime.lifeRegistry.getById('elysia-main')
      expect(life).toBeDefined()
      expect(life?.id).toBe('elysia-main')
    })

    it('加载多个生命体时 registry 应包含所有实例', async () => {
      const manifest = parseManifest(JSON.stringify({
        version: '1.0',
        lifeInstances: [
          { id: 'life-a', type: 'elysia-default' },
          { id: 'life-b', type: 'elysia-default' },
          { id: 'life-c', type: 'elysia-default', enabled: false },
        ],
      }))

      await runtime.loadManifest(manifest)

      expect(runtime.lifeRegistry.getById('life-a')).toBeDefined()
      expect(runtime.lifeRegistry.getById('life-b')).toBeDefined()
      expect(runtime.lifeRegistry.getById('life-c')).toBeUndefined()
      expect(runtime.lifeRegistry.getAll()).toHaveLength(2)
    })

    it('加载 manifest 时应发出 life.loaded 事件', async () => {
      const handler = vi.fn()
      runtime.context.eventBus.on('life.loaded', handler)

      await runtime.loadManifest({
        version: '1.0',
        lifeInstances: [
          { id: 'life-1', type: 'elysia-default' },
          { id: 'life-2', type: 'elysia-default' },
        ],
      })

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('消息进入 Runtime 链路', () => {
    it('handlePlatformMessage 应触发 stimulus.received 事件', async () => {
      const stimulusHandler = vi.fn()
      runtime.context.eventBus.on('stimulus.received', stimulusHandler)

      await handlePlatformMessage(runtime, {
        id: 'msg-integration-1',
        platform: 'qq',
        botId: 'bot-001',
        guildId: 'guild-123',
        channelId: 'channel-456',
        userId: 'user-789',
        content: 'Hello Elysia!',
        timestamp: Date.now(),
      })

      expect(stimulusHandler).toHaveBeenCalledOnce()
      expect(stimulusHandler.mock.calls[0][0].stimulusId).toBe('msg-integration-1')
    })

    it('未启动的 runtime 应忽略 stimulus', async () => {
      const freshRuntime = createDefaultRuntime()
      // 不调用 start()

      const handler = vi.fn()
      freshRuntime.context.eventBus.on('stimulus.received', handler)

      await handlePlatformMessage(freshRuntime, {
        id: 'msg-ignored',
        platform: 'qq',
        botId: 'bot-001',
        content: 'should be ignored',
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('多条消息应依次触发事件', async () => {
      const handler = vi.fn()
      runtime.context.eventBus.on('stimulus.received', handler)

      const messages = ['msg-1', 'msg-2', 'msg-3']
      for (const id of messages) {
        await handlePlatformMessage(runtime, {
          id,
          platform: 'qq',
          botId: 'bot-001',
          content: `message ${id}`,
        })
      }

      expect(handler).toHaveBeenCalledTimes(3)
      const receivedIds = handler.mock.calls.map(c => c[0].stimulusId)
      expect(receivedIds).toEqual(messages)
    })
  })

  describe('完整 Phase 1 场景', () => {
    it('应完成：创建 runtime → 加载生命体 → 接收消息 → 触发事件', async () => {
      // 1. 加载生命体
      await runtime.loadManifest({
        version: '1.0',
        lifeInstances: [
          { id: 'elysia-main', type: 'elysia-default' },
        ],
      })

      // 2. 验证生命体已注册
      expect(runtime.lifeRegistry.getById('elysia-main')).toBeDefined()

      // 3. 接收消息
      const stimulusHandler = vi.fn()
      runtime.context.eventBus.on('stimulus.received', stimulusHandler)

      await handlePlatformMessage(runtime, {
        id: 'final-test-msg',
        platform: 'qq',
        botId: 'bot-001',
        guildId: 'guild-main',
        userId: 'user-001',
        content: 'Phase 1 complete!',
      })

      // 4. 验证事件触发
      expect(stimulusHandler).toHaveBeenCalledOnce()
      const stimulus = stimulusHandler.mock.calls[0][0]
      expect(stimulus.stimulusId).toBe('final-test-msg')

      // 5. 停止 runtime
      await runtime.stop()
      expect(runtime.getState()).toBe('stopped')
    })
  })
})
