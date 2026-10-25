/**
 * Phase 2 集成测试
 *
 * 验证以下完整链路：
 * 1. 行为引擎 / stimulus → cognition 事件入账；触发唤醒 → behavior.instruction
 * 2. Brain 层正确封装 system prompt / context window
 * 3. Gateway 容错（retry）
 * 4. 事件驱动解耦（所有模块通过 event bus 协作）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asCordisContext } from 'koishi'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { DefaultBrainService } from '../packages/@elysia-ai/brain/src/index.js'
import { DefaultModelGatewayService } from '../packages/@elysia-ai/model-gateway/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import type {
  ModelGatewayResponse,
  DialogueMessage,
} from '../packages/@elysia-ai/core'

// ─────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────

function makeMockGateway(response?: Partial<ModelGatewayResponse>) {
  return {
    execute: vi.fn().mockResolvedValue({
      output: response?.output ?? 'mock output',
      messages: response?.messages ?? [],
      provider: response?.provider ?? { id: 'mock', type: 'chat-completions' as const, model: 'gpt-4o' },
      usage: response?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: response?.finishReason ?? 'stop',
      metadata: response?.metadata ?? {},
    }),
  }
}

function makeMockProviderResponse(providerId: string, output = 'mock output') {
  return {
    output,
    messages: [{ role: 'assistant' as const, content: output }],
    provider: { id: providerId, type: 'chat-completions' as const, model: 'mock-model' },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
    metadata: {},
  }
}

function makeMockKoishiContext(runtime: Runtime) {
  const disposeHandlers: Array<() => void> = []

  const ctx = {
    'elysia.runtime': runtime,
    logger() {
      return { info: vi.fn(), debug: vi.fn(), error: vi.fn() }
    },
    on(event: string, handler: () => void) {
      if (event === 'dispose') disposeHandlers.push(handler)
    },
    dispose() {
      for (const handler of disposeHandlers) handler()
    },
  } as any

  return asCordisContext(ctx)
}

function listenEvents(runtime: Runtime) {
  const events: Record<string, any[]> = {}
  const bus = runtime.context.eventBus as any

  bus.on('cognition.event.recorded', (payload: any) => {
    ;(events['cognition.event.recorded'] ??= []).push(payload)
  })
  bus.on('behavior.trigger.fired', (payload: any) => {
    ;(events['behavior.trigger.fired'] ??= []).push(payload)
  })
  bus.on('behavior.instruction', (payload: any) => {
    ;(events['behavior.instruction'] ??= []).push(payload)
  })

  return events
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// ─────────────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────────────

describe('Phase 2 集成测试', () => {
  // ---- 2-A Behavior 驱动 ----

  describe('2-A 行为引擎 — 事件驱动管道', () => {
    let runtime: Runtime
    let koishiCtx: ReturnType<typeof makeMockKoishiContext>

    beforeEach(async () => {
      runtime = createDefaultRuntime()
      koishiCtx = makeMockKoishiContext(runtime)
      // cognition（事件注入层）先于 behavior 注册：behavior 依赖 elysia.cognition 服务。
      cognitionPlugin.apply(koishiCtx, {
        events: {
          enabled: true,
          feed: { maxEvents: 30 },
          history: { maxEvents: 100, windowMs: 30 * 60_000 },
        },
      })
      behaviorPlugin.apply(koishiCtx, {
        enableReply: true,
        batcher: {
          quietWindowMs: 8_000,
          dmQuietWindowMs: 1_500,
          maxWaitMs: 30_000,
          densityWindowMs: 10_000,
          densityThreshold: 15,
          maxBatch: 50,
        },
        packMemory: { maxPacks: 12, injectPacks: 2 },
      })
      await runtime.start()
      await runtime.loadManifest({
        version: '1.0',
        lifeInstances: [{ id: 'life-test', type: 'elysia-default' }],
      })
    })

    afterEach(async () => {
      koishiCtx.dispose()
      if (runtime.getState() === 'running') await runtime.stop()
    })

    it('stimulus 入账 cognition 事件；触发唤醒驱动 behavior.instruction', async () => {
      const events = listenEvents(runtime)

      const stimulus = {
        id: 'stim-2a-1',
        type: 'utterance',
        payload: { content: '你好' },
        habitatId: 'habitat-test',
        actorId: 'user-test',
        threadId: 'thread-test',
        timestamp: Date.now(),
      }

      // 主链接入统一走 runtime.receiveStimulus（kernel 管线编排）：
      // 裸 emit stimulus.received/projection.routed 只发事实事件，
      // 不再驱动认知/行为（阶段钩子由管线调度）。
      await runtime.receiveStimulus(stimulus as never)

      await new Promise((resolve) => setTimeout(resolve, 100))

      // 触发器重构后：普通刺激只进事件历史（cognition.event.recorded），
      // 不直接唤醒 LLM（不产生 behavior.instruction）。
      expect(events['cognition.event.recorded'] ?? []).toHaveLength(1)
      expect(events['cognition.event.recorded'][0].lifeId).toBe('life-test')
      expect(events['behavior.instruction'] ?? []).toHaveLength(0)

      // 触发唤醒（behavior 服务统一入口）→ 合成触发刺激走完整主链 →
      // behavior.trigger.fired → behavior.instruction。
      const behavior = (koishiCtx as any).get('elysia.behavior')
      expect(behavior).toBeTruthy()
      behavior.fireTrigger({
        lifeId: 'life-test',
        habitatId: 'habitat-test',
        source: 'manual',
        reason: 'phase2-manual',
      })

      await waitFor(() => (events['behavior.instruction'] ?? []).length >= 1)

      expect(events['behavior.trigger.fired'] ?? []).toHaveLength(1)
      expect(events['behavior.trigger.fired'][0].source).toBe('manual')

      const instruction = events['behavior.instruction'][0].instruction
      expect(instruction.lifeId).toBe('life-test')
      expect(instruction.actions).toBeDefined()
      expect(Array.isArray(instruction.actions)).toBe(true)
      expect(instruction.actions[0].type).toBe('dialogue')
    })
  })

  // ---- 2-B Brain 层 ----

  describe('2-B Brain 层 — system prompt / context window', () => {
    it('应自动构造 system message', async () => {
      const gateway = makeMockGateway()
      const brain = new DefaultBrainService(
        { systemPrompt: '你是一个测试助手' },
        gateway,
      )

      await brain.execute({
        task: 'dialogue-generation',
        messages: [{ role: 'user', content: 'hello' }],
        capability: 'dialogue-generation',
      })

      const msgs = gateway.execute.mock.calls[0][0].messages as DialogueMessage[]
      const sys = msgs.find((m: DialogueMessage) => m.role === 'system')
      expect(sys).toBeDefined()
      expect(sys!.content).toBe('你是一个测试助手')
    })

    it('应按 contextWindow 裁剪消息', async () => {
      const gateway = makeMockGateway()
      const brain = new DefaultBrainService(
        { contextWindow: 2 },
        gateway,
      )

      await brain.execute({
        task: 'dialogue-generation',
        messages: [
          { role: 'user', content: 'msg-1' },
          { role: 'assistant', content: 'msg-2' },
          { role: 'user', content: 'msg-3' },
        ],
        capability: 'dialogue-generation',
      })

      const msgs = gateway.execute.mock.calls[0][0].messages as DialogueMessage[]
      const userMsgs = msgs.filter((m: DialogueMessage) => m.role !== 'system')
      expect(userMsgs.length).toBeLessThanOrEqual(2)
      expect(userMsgs[userMsgs.length - 1].content).toBe('msg-3')
    })

    it('请求中的 systemPrompt 应覆盖默认值', async () => {
      const gateway = makeMockGateway()
      const brain = new DefaultBrainService(
        { systemPrompt: '默认助手' },
        gateway,
      )

      await (brain.execute as any)({
        task: 'dialogue-generation',
        messages: [{ role: 'user', content: 'hi' }],
        capability: 'dialogue-generation',
        systemPrompt: '覆盖的 system prompt',
      })

      const msgs = gateway.execute.mock.calls[0][0].messages as DialogueMessage[]
      const sys = msgs.find((m: DialogueMessage) => m.role === 'system')
      expect(sys!.content).toBe('覆盖的 system prompt')
    })

    it('Brain 错误时应重新抛出', async () => {
      const error = new Error('gateway error')
      const gateway = { execute: vi.fn().mockRejectedValue(error) }
      const brain = new DefaultBrainService({}, gateway)

      await expect(
        brain.execute({
          task: 'dialogue-generation',
          messages: [{ role: 'user', content: 'hello' }],
          capability: 'dialogue-generation',
        }),
      ).rejects.toThrow('gateway error')
    })
  })

  // ---- 2-C Gateway 容错 ----

  describe('2-C Gateway 容错 — retry + fallback', () => {
    it('应在单 slot 失败时重试', async () => {
      const gateway = new DefaultModelGatewayService({
        providers: {
          test: { type: 'chat-completions', apiKey: 'key', baseURL: 'https://gateway.test' },
        },
        providerSlots: {
          test: { provider: 'test', model: 'm' },
        },
        defaultSlot: 'test',
        maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100,
      })

      const provider = gateway.getRegistry().resolveSlot('test')!
      let calls = 0
      provider.execute = vi.fn(async () => {
        calls++
        if (calls < 3) {
          // P2-10 后重试白名单化：真实 provider 对 HTTP 500 抛 ProviderError
          //（statusCode 500 默认 retryable），裸 Error 不再可重试。
          const { ProviderError } = await import('../packages/@elysia-ai/model-gateway/src/providers/types.js')
          throw new ProviderError('test 500', 'slot:test', 500)
        }
        return makeMockProviderResponse('slot:test', 'retry ok')
      })

      const result = await gateway.execute({
        task: 'test-retry',
        lifeId: 'life-1',
        slot: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(provider.execute).toHaveBeenCalledTimes(3)
      expect(result.output).toBeDefined()
    })

    it('slot provider 失败时应抛出错误', async () => {
      const gateway = new DefaultModelGatewayService({
        providers: {
          failing: { type: 'chat-completions', apiKey: 'k', baseURL: 'https://gateway.test' },
        },
        providerSlots: {
          failing: { provider: 'failing', model: 'm' },
        },
        defaultSlot: 'failing',
        maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100,
      })

      const provider = gateway.getRegistry().resolveSlot('failing')!
      provider.execute = vi.fn(async () => {
        const err = new Error('always down')
        ;(err as any).statusCode = 500
        throw err
      })

      await expect(
        gateway.execute({
          task: 'test-fail',
          lifeId: 'life-1',
          slot: 'failing',
          messages: [{ role: 'user', content: 'fail' }],
        }),
      ).rejects.toThrow(/failed after/)
    })

    it('无 slot 配置时应抛出路由错误', async () => {
      const gateway = new DefaultModelGatewayService({
        maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100,
      })

      await expect(
        gateway.execute({
          task: 'test-no-slot',
          lifeId: 'life-1',
          messages: [{ role: 'user', content: 'no slot' }],
        }),
      ).rejects.toThrow(/No provider available/)
    })
  })

  // ---- 2-D 端到端 ----

  describe('2-D 完整端到端场景', () => {
    it('模块结构验证：gateway / brain 可链式构造', () => {
      const gateway = new DefaultModelGatewayService({
        providers: {
          main: { type: 'chat-completions', apiKey: 'key', baseURL: 'https://gateway.test' },
        },
        providerSlots: {
          main: { provider: 'main', model: 'model' },
        },
        defaultSlot: 'main',
        maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50,
      })

      const brain = new DefaultBrainService(
        { systemPrompt: '你是友善的助手', contextWindow: 10, defaultModelSlot: 'main' },
        gateway,
      )

      expect(gateway.getRegistry().size).toBe(1)
      expect(brain).toBeDefined()
    })
  })
})
