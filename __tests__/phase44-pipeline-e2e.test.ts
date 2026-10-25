import { describe, expect, it } from 'vitest'
import { createDefaultRuntime } from 'koishi-plugin-elysia-ai-runtime'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import { createPerceptionPluginRuntime } from '@elysia-ai/perception'
import { createCognitionPluginRuntime } from '@elysia-ai/cognition'
import { createBehaviorPluginRuntime } from '@elysia-ai/behavior'
import { createDialoguePluginRuntime } from '@elysia-ai/dialogue'
import type { BrainService, CoreEventMap } from '@elysia-ai/core'
import { NS_DIALOGUE_OUTPUT } from '@elysia-ai/core'

/**
 * Review BUG-4 补测：receiveStimulus → … → sender 的真实端到端链路
 * （主链库钩子装配 + 触发器重构后的事件顺序 + trace 事件）。
 *
 * 触发链路：普通刺激 → cognition 事件入账 → 密度合并器（maxBatch=1 即触发）
 * → 合成触发刺激走完整主链 → behavior.instruction → dialogue（agentic 工具循环）。
 */

const logger = { info() {}, debug() {}, warn() {}, error() {} }

function wireMainChain(runtime: Runtime, brain: BrainService) {
  createPerceptionPluginRuntime({
    runtime: { context: runtime.context },
    config: {
      enabledIntentClassify: true,
      enabledEntityExtract: true,
      enabledSentiment: true,
    },
    logger,
  })
  const cognition = createCognitionPluginRuntime({
    runtime: { context: runtime.context },
    config: {
      events: {
        enabled: true,
        feed: { maxEvents: 30 },
        history: { maxEvents: 100, windowMs: 30 * 60_000 },
      },
    },
    logger,
  })
  createBehaviorPluginRuntime({
    runtime: {
      context: runtime.context,
      receiveStimulus: (stimulus) => {
        void runtime.receiveStimulus(stimulus)
      },
    },
    cognition: cognition.service,
    config: {
      enableReply: true,
      batcher: {
        quietWindowMs: 8_000,
        dmQuietWindowMs: 1_500,
        maxWaitMs: 30_000,
        densityWindowMs: 10_000,
        densityThreshold: 15,
        // 单批 1 条即触发：测试内同步走完 触发→唤醒→对话 全链
        maxBatch: 1,
      },
      packMemory: { maxPacks: 12, injectPacks: 2 },
    },
    logger,
  })
  createDialoguePluginRuntime({
    runtime: { context: runtime.context },
    brain,
    config: { enabled: true, memoryLimit: 10 },
    logger,
  })
}

describe('Phase 44：receiveStimulus → sender 端到端', () => {
  it('全链路：事件顺序完整、输出进入上下文并送达 sender 钩子、trace 事件两棵树', async () => {
    const runtime = createDefaultRuntime(logger)
    let brainCalls = 0
    const brain: BrainService = {
      // agentic 唤醒协议：第 1 轮调用 send_reply 输出一段发言，第 2 轮纯文本收尾。
      async execute(request) {
        brainCalls++
        if (brainCalls === 1) {
          return {
            output: '',
            toolCalls: [{
              id: 'call-send-1',
              type: 'function',
              name: 'send_reply',
              arguments: { text: 'e2e reply' },
            }],
            messages: [...request.messages, {
              role: 'assistant' as const,
              content: '',
              toolCalls: [{
                id: 'call-send-1',
                type: 'function',
                name: 'send_reply',
                arguments: { text: 'e2e reply' },
              }],
            }],
          }
        }
        return { output: 'done', messages: [] }
      },
    }
    wireMainChain(runtime, brain)

    const events: string[] = []
    runtime.context.eventBus.onAny((event) => events.push(event))

    const sentOutputs: string[] = []
    runtime.context.pipeline!.registerHook({
      stage: 'sender',
      owner: 'test-sender',
      async run(pctx) {
        const outputs = pctx.read<CoreEventMap['dialogue.output.created'][]>(NS_DIALOGUE_OUTPUT) ?? []
        for (const output of outputs) sentOutputs.push(output.content)
      },
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-e2e', type: 'elysia-default' }],
    })
    await runtime.start()

    await runtime.receiveStimulus({
      id: 'stim-e2e',
      type: 'utterance',
      timestamp: Date.now(),
      habitatId: 'hab-e2e',
      payload: { content: '你好' },
      actorId: 'user-e2e',
      isDirectMessage: true,
    } as never)

    // 触发唤醒的合成刺激在同 habitat 队列中异步排队处理，等待对话链完成。
    const deadline = Date.now() + 5_000
    while (!events.includes('dialogue.completed')) {
      if (Date.now() > deadline) throw new Error(`wake chain did not complete; events: ${events.join(',')}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // 事件顺序：原始刺激段（stimulus.received → perception → cognition 入账 →
    // 触发器点火）先完成，随后合成触发刺激走 唤醒→指令→对话 全链。
    // dialogue.task.created 不纳入单调序断言，单独验证出现次数。
    const expectedOrder = [
      'stimulus.received',
      'perception.completed',
      'projection.routed',
      'cognition.event.recorded',
      'behavior.trigger.fired',
      'behavior.instruction',
      'dialogue.generation.requested',
      'dialogue.started',
      'dialogue.generated',
      'dialogue.output.created',
      'dialogue.completed',
    ]
    const positions = expectedOrder.map((name) => events.indexOf(name))
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(events.filter((event) => event === 'dialogue.task.created').length).toBeGreaterThanOrEqual(1)
    // 合成触发刺激只进唤醒分支，不再入账 cognition 事件（防自循环）。
    expect(events.filter((event) => event === 'cognition.event.recorded')).toHaveLength(1)

    // 输出进入共享上下文并被 sender 钩子消费。
    expect(sentOutputs).toEqual(['e2e reply'])

    // trace：原始刺激 + 合成触发刺激各两棵树（刺激段 + 生命段）。
    const traceEvents = events.filter((event) => event === 'runtime.trace.completed')
    expect(traceEvents.length).toBeGreaterThanOrEqual(2)

    await runtime.stop()
  })
})
