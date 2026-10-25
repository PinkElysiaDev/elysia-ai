import { describe, expect, it } from 'vitest'
import { afterEach, beforeEach } from 'vitest'
import { createDefaultRuntime } from 'koishi-plugin-elysia-ai-runtime'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import { createBehaviorPluginRuntime } from '@elysia-ai/behavior'
import type { BehaviorPluginRuntime } from '@elysia-ai/behavior'
import type { CoreEventMap } from '@elysia-ai/core'

/**
 * P2-19 读路径补测：behavior 的 getHomeostasis 注入口。
 *
 * 提供时唤醒 userMessage 注入"你当前的状态"四值段；返回 undefined
 * （服务缺失/无状态）时跳过该段，唤醒照常。
 */

const logger = { info() {}, debug() {}, warn() {}, error() {} }

describe('behavior 唤醒提示的稳态状态注入（getHomeostasis）', () => {
  let runtime: Runtime
  let behaviorRuntime: BehaviorPluginRuntime

  function setup(getHomeostasis?: () => { energy: number, mood: number, sociability: number, curiosity: number } | undefined) {
    runtime = createDefaultRuntime(logger)
    behaviorRuntime = createBehaviorPluginRuntime({
      runtime: {
        context: runtime.context,
        receiveStimulus: (stimulus) => {
          void runtime.receiveStimulus(stimulus)
        },
      },
      config: { enableReply: true },
      logger,
      ...(getHomeostasis ? { getHomeostasis } : {}),
    })
    return behaviorRuntime.service
  }

  async function wakeAndCaptureUserMessage(): Promise<string> {
    const instructions: CoreEventMap['behavior.instruction'][] = []
    runtime.context.eventBus.on('behavior.instruction', (payload) => instructions.push(payload))

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-homeo-inject', type: 'elysia-default' }],
    })
    await runtime.start()

    behaviorRuntime.service.fireTrigger({
      lifeId: 'life-homeo-inject',
      habitatId: 'hab-homeo-inject',
      source: 'manual',
      reason: 'test-wake',
    })

    const deadline = Date.now() + 5_000
    while (instructions.length === 0) {
      if (Date.now() > deadline) throw new Error('wake did not produce behavior.instruction')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    const task = instructions[0].instruction.actions[0] as unknown as {
      type: string
      task: { metadata: { currentUserContent?: string } }
    }
    expect(task.type).toBe('dialogue')
    return task.task.metadata.currentUserContent ?? ''
  }

  beforeEach(() => {
    // setup is called explicitly per test（需要不同注入形状）
  })

  afterEach(async () => {
    behaviorRuntime?.dispose()
    if (runtime.getState() === 'running') await runtime.stop()
  })

  it('getHomeostasis 提供状态时唤醒 userMessage 含"你当前的状态"段（两位小数）', async () => {
    setup(() => ({ energy: 0.42, mood: 0.6, sociability: 0.135, curiosity: 1 }))
    const userMessage = await wakeAndCaptureUserMessage()

    expect(userMessage).toContain('你当前的状态')
    expect(userMessage).toContain('精力 0.42')
    expect(userMessage).toContain('心情 0.60')
    expect(userMessage).toContain('社交意愿 0.14')
    expect(userMessage).toContain('好奇心 1.00')
    expect(userMessage).toContain('由你自行把握分寸')
    // 状态段在事件清单段之前
    expect(userMessage.indexOf('你当前的状态')).toBeLessThan(userMessage.indexOf('=== 聊天实时事件'))
  })

  it('getHomeostasis 返回 undefined 时无状态段', async () => {
    setup(() => undefined)
    const userMessage = await wakeAndCaptureUserMessage()

    expect(userMessage).not.toContain('你当前的状态')
    expect(userMessage).toContain('=== 聊天实时事件')
  })

  it('未提供 getHomeostasis 时无状态段（可选依赖）', async () => {
    setup()
    const userMessage = await wakeAndCaptureUserMessage()

    expect(userMessage).not.toContain('你当前的状态')
  })
})
