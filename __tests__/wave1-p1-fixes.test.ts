import { describe, expect, it, vi } from 'vitest'

/**
 * Wave 1 P1 修复回归：
 * 1. wrapper 装配下默认即时规则（被@必应/私聊必应）生效——不再被空数组短路
 * 2. wrapper 透传 receiveStimulus 的 priority 参数
 * 3. 定时任务持久化 routing 并在 fire 时传递（冷启动发送恢复）
 * 4. RouteMessageSender 直发兜底（habitat 注册表空时经 bot sendMessage）
 */

import { apply as behaviorApply } from '../packages/elysia-ai-behavior/src/index.js'
import type { TriggerTask } from '../packages/@elysia-ai/core/src/index.js'
import { RouteMessageSender, OutboundRouteRegistry, HabitatSendRegistry } from '../packages/elysia-ai-body/src/sender/index.js'

function mockKoishiCtx(runtime: Record<string, unknown>) {
  const setCalls: Array<[string, unknown]> = []
  const ctx: any = {
    set: vi.fn((name: string, value: unknown) => setCalls.push([name, value])),
    get: vi.fn((name: string) => runtime[name]),
    on: vi.fn(() => () => {}),
    bots: [],
    logger: () => ({ info() {}, debug() {}, warn() {}, error() {} }),
  }
  return { ctx, setCalls }
}

function fakeRuntime() {
  const stimuli: Array<{ stimulus: unknown, options?: { priority?: number } }> = []
  return {
    stimuli,
    runtime: {
      context: {
        eventBus: { on: vi.fn(() => () => {}), emit: vi.fn(async () => {}) },
        // 主链单轨：装配需要管线钩子；本组用例不驱动主链，桩即可
        pipeline: { registerHook: vi.fn(() => () => {}) } as never,
      },
      receiveStimulus: vi.fn((stimulus: unknown, options?: { priority?: number }) => {
        stimuli.push({ stimulus, options })
      }),
      behaviorExecution: undefined,
    },
  }
}

describe('W1-1/W1-2：wrapper 装配的默认即时规则与 priority 透传', () => {
  it('用户未配置 instantRules 时默认规则生效（不被 [] 短路）', async () => {
    const { runtime, stimuli } = fakeRuntime()
    const { ctx } = mockKoishiCtx({ 'elysia.runtime': runtime })

    // 不传 instantRules（模拟 schemastery 对缺失 array 给 undefined/[]）
    behaviorApply(ctx, {} as never)
    const service = ctx.set.mock.calls.find(([name]) => name === 'elysia.behavior')?.[1] as
      | { fireTrigger(request: Record<string, unknown>): void }
      | undefined
    expect(service).toBeTruthy()

    // 模拟一条被@事件经三层分发触发即时唤醒：直接调 fireTrigger 验证插队优先级即可
    service!.fireTrigger({ lifeId: 'life-1', habitatId: 'g1', source: 'instant', reason: '规则:被@必应' })
    await vi.waitFor(() => expect(stimuli.length).toBeGreaterThan(0))
    expect(stimuli[0].options).toEqual({ priority: 0 })  // W1-2：instant 插队透传

    // batcher 来源 priority 1
    service!.fireTrigger({ lifeId: 'life-1', habitatId: 'g1', source: 'batcher', reason: 'quiet' })
    await vi.waitFor(() => expect(stimuli.length).toBeGreaterThan(1))
    expect(stimuli[1].options).toEqual({ priority: 1 })
  })

  it('schemastery 空数组（[]）输入时默认规则仍生效——真断言（曾为空断言回归盲区）', async () => {
    const { runtime, stimuli } = fakeRuntime()
    const { ctx } = mockKoishiCtx({ 'elysia.runtime': runtime })
    // 模拟 schemastery 对未配置 array 字段解析出的 []（历史上两次踩坑的形态）
    behaviorApply(ctx, { instantRules: [] } as never)
    const service = ctx.set.mock.calls.find(([name]) => name === 'elysia.behavior')?.[1] as
      | { fireTrigger(request: Record<string, unknown>): void }
      | undefined
    expect(service).toBeTruthy()
    service!.fireTrigger({ lifeId: 'life-1', habitatId: 'g1', source: 'instant', reason: '规则:被@必应' })
    await vi.waitFor(() => expect(stimuli.length).toBeGreaterThan(0))
    // 默认规则下的即时唤醒以 priority 0 插队——若默认规则被 [] 短路，则不会有任何唤醒
    expect(stimuli[0].options).toEqual({ priority: 0 })
  })
})

describe('W1-5：定时任务 routing 持久化与 fire 传递', () => {
  it('create 存 routing → 到期 fire 携带 routing（冷启动发送恢复）', async () => {
    const { MemoryTriggerTaskRepository, TriggerManager } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const fired: Array<{ habitatId?: string, routing?: TriggerTask['routing'] }> = []
    let now = 1_700_000_000_000
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: ({ habitatId, routing }) => fired.push({ habitatId, routing }),
      checkAdmin: async () => true,
      now: () => now,
    })
    const created = await manager.create({
      name: '冷启动任务',
      habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 },
      prompt: 'p',
      ownerKey: 'o',
      routing: { platform: 'onebot', botId: 'bot1', channelId: 'g1', guildId: 'g1' },
    }) as TriggerTask
    expect(created.routing).toEqual({ platform: 'onebot', botId: 'bot1', channelId: 'g1', guildId: 'g1' })

    now += 61_000
    await manager['harvest']()
    expect(fired).toHaveLength(1)
    // 非广播任务 fire 不带 habitatId（behavior 回调用 task.habitatId 兜底），routing 必须传递
    expect(fired[0].routing).toEqual({ platform: 'onebot', botId: 'bot1', channelId: 'g1', guildId: 'g1' })

    // 持久化往返（仓储保存完整 task 含 routing）
    const reloaded = await manager.get(created.id)
    expect(reloaded?.routing?.platform).toBe('onebot')
  })
})

describe('W2：行为正确性修复回归', () => {
  it('W2-8: pause_until 到期自动恢复排程（不补跑）', async () => {
    const { MemoryTriggerTaskRepository, TriggerManager } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const fires: unknown[] = []
    let now = 1_700_000_000_000
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: () => { fires.push(1) },
      checkAdmin: async () => true,
      now: () => now,
    })
    const created = await manager.create({
      name: 'p', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 }, prompt: 'p', ownerKey: 'o',
    }) as TriggerTask

    await manager.pauseUntil(created.id, now + 120_000)
    const paused = await manager.get(created.id)
    expect(paused?.state.status).toBe('paused')

    now += 130_000
    await manager['harvest']()  // 到期 paused → 恢复 waiting（重排）
    const resumed = await manager.get(created.id)
    expect(resumed?.state.status).toBe('waiting')
    expect(fires).toHaveLength(0)  // 恢复点不补跑
  })

  it('W2-9: error 状态任务在 start() 时复活重排', async () => {
    const { MemoryTriggerTaskRepository, TriggerManager } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    const store = new MemoryTriggerTaskRepository()
    let now = 1_700_000_000_000
    const task: TriggerTask = {
      id: 'dead', name: 'x', enabled: true, habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o',
      createdAt: now, updatedAt: now,
      state: { status: 'error', nextRunAt: null, occurrenceKey: null, lastRunAt: now - 1000, runCount: 5, lastError: 'boom', pausedUntil: null },
    }
    await store.save(task)
    const manager = new TriggerManager({
      store,
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: () => {},
      checkAdmin: async () => true,
      now: () => now,
    })
    await manager.start()
    const revived = await store.get('dead')
    expect(revived?.state.status).toBe('waiting')
    expect(revived?.state.nextRunAt).not.toBeNull()
    expect(revived?.state.runCount).toBe(5)  // 保留历史统计
  })

  it('W2-11: 即时规则拒绝 system 组事件（防 bot-sent 自问自答死循环）', async () => {
    const { InstantEngine } = await import('../packages/@elysia-ai/trigger/src/instant.js')
    const engine = new InstantEngine({
      getConfig: () => [{
        id: 'bad', name: '危险规则', enabled: true, eventKey: 'bot-sent',
        action: { type: 'llm' }, cooldownMs: 0,
      }],
      now: () => 0,
    })
    const botSentEvent = { key: 'bot-sent', timestamp: 0, habitatId: 'g', payload: {} }
    expect(engine.match(botSentEvent as never)).toBeUndefined()
    // 正常 message 事件不受影响
    const okEngine = new InstantEngine({
      getConfig: () => [{
        id: 'ok', name: '正常规则', enabled: true, eventKey: 'message',
        action: { type: 'llm' }, cooldownMs: 0,
      }],
      now: () => 0,
    })
    expect(okEngine.match({ key: 'message', timestamp: 0, habitatId: 'g', payload: {} } as never)).toBeDefined()
  })

  it('W2-10: reaction 桥接过滤 bot 自身贴的表情（防自激励）', async () => {
    const { KoishiBodyAdapter } = await import('../packages/elysia-ai-body/src/adapters/koishi/koishi-body-adapter.js')
    const received: unknown[] = []
    const listeners = new Map<string, (session: unknown) => unknown>()
    const ctx = {
      logger: () => ({ info() {}, debug() {}, warn() {}, error() {} }),
      on: (event: string, listener: (session: unknown) => unknown) => {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      },
    } as never
    const adapter = new KoishiBodyAdapter(ctx, { receiveStimulus: (s: unknown) => { received.push(s); return Promise.resolve() } } as never)
    adapter.registerListeners()
    const handler = listeners.get('notice')!

    // bot 自己贴的表情 → 忽略
    await handler({ subtype: 'group_msg_emoji_like', platform: 'onebot', selfId: 'bot1', onebot: { group_id: 1, user_id: 'bot1', likes: [{ emoji_id: '76' }] } })
    expect(received).toHaveLength(0)
    // 用户贴的表情（下划线命名）→ 归一入账
    await handler({ subtype: 'group_msg_emoji_like', platform: 'onebot', selfId: 'bot1', onebot: { group_id: 1, user_id: 'u1', likes: [{ emoji_id: '76' }] } })
    expect(received).toHaveLength(1)
  })
})

describe('第二轮 W1：P1 修复回归', () => {
  it('W1-2: claim 失败不整写快照（不复活已删除任务）', async () => {
    const { MemoryTriggerTaskRepository, TriggerManager } = await import('../packages/@elysia-ai/behavior/src/trigger-manager.js')
    type TriggerTask = import('../packages/@elysia-ai/core/src/index.js').TriggerTask
    const BASE = 1_700_000_000_000
    let now = BASE
    const store = new MemoryTriggerTaskRepository()
    const fires: unknown[] = []
    const manager = new TriggerManager({
      store,
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: () => { fires.push(1) },
      checkAdmin: async () => true,
      now: () => now,
    })
    const task: TriggerTask = {
      id: 'zombie', name: 'x', enabled: true, habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 }, prompt: 'p', ownerKey: 'o',
      createdAt: BASE, updatedAt: BASE,
      state: { status: 'waiting', nextRunAt: BASE + 60_000, occurrenceKey: 'k1', lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null },
    }
    // 模拟竞态：收割拿到 waiting 快照后、claim 前任务被用户删除
    await store.save(task)
    await store.remove('zombie')
    await manager['runTask'](task, BASE + 61_000)
    // 修复前：save 复活僵尸；修复后：store 无此任务且不点火
    expect(await store.get('zombie')).toBeNull()
    expect(fires).toHaveLength(0)
  })

  it('W1-3: stay_silent 后 send_reply 翻案（last-call-wins）', async () => {
    const { createWakeTools, createWakeToolState, resolveWakeOutput } = await import('../packages/@elysia-ai/behavior/src/tools.js')
    const state = createWakeToolState()
    const tools = createWakeTools({ state, getRecentPacks: () => [], renderPack: () => '' })
    const byName = (name: string) => tools.find((tool) => tool.definition.name === name)!
    await byName('stay_silent').execute({ reason: '先不说话' })
    await byName('send_reply').execute({ text: '改主意了' })
    const resolved = resolveWakeOutput(state, { output: '', toolCalls: [], executed: [], messages: [], rounds: 2, stopReason: 'completed' })
    expect(resolved.silent).toBe(false)
    expect(resolved.segments).toEqual(['改主意了'])
  })

  it('W1-4/5: 唤醒记忆与对话史用摘要而非全文', async () => {
    const { createBehaviorPluginRuntime } = await import('../packages/@elysia-ai/behavior/src/index.js')
    const { DEFAULT_CONFIG } = await import('../packages/@elysia-ai/behavior/src/types.js')
    const { createDefaultRuntime } = await import('../packages/elysia-ai-runtime/src/runtime.js')
    const memoryRequests: Array<Record<string, unknown>> = []
    // 真实 DefaultRuntime 主链（单轨）：fireTrigger → receiveStimulus → 管线钩子
    const runtime = createDefaultRuntime()
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'life-1', type: 'elysia-default' }] })
    await runtime.start()
    runtime.behaviorExecution = {
      async execute(plan: { actions: Array<{ payload?: { request?: Record<string, unknown> } }> }) {
        for (const action of plan.actions) {
          if (action.payload?.request) memoryRequests.push(action.payload.request)
        }
        return { completed: true } as never
      },
    } as never
    const cognition = {
      ingest: () => null,
      buildFeed: () => ['[12:00:00] 消息 | u1: 你好'.repeat(10)],
      getRecentEvents: () => [{ key: 'message', timestamp: Date.now(), habitatId: 'g1', actorId: 'u1', stimulusId: 'm1', payload: { content: '你好' } }],
    }
    const plugin = createBehaviorPluginRuntime({
      runtime: runtime as never,
      cognition: cognition as never,
      config: { ...DEFAULT_CONFIG },
      logger: { info() {}, debug() {}, warn() {}, error() {} },
    })
    plugin.service.fireTrigger({ lifeId: 'life-1', habitatId: 'g1', source: 'manual', reason: 'test', directive: '看看群里聊什么' })
    await vi.waitFor(() => expect(memoryRequests.length).toBeGreaterThan(0), { timeout: 3000 })
    const memoryContent = memoryRequests.find((request) => 'content' in request)?.['content']
    expect(typeof memoryContent).toBe('string')
    // 摘要格式：一行，含来源/原因/事件数，不含事件清单分隔线
    expect(String(memoryContent)).toMatch(/^触发唤醒\(manual\/test\)，事件 \d+ 条/)
    expect(String(memoryContent)).not.toContain('===')
    plugin.dispose()
    await runtime.stop()
  })
})

describe('W1-5：RouteMessageSender 直发兜底', () => {
  it('route 与 habitat 注册表均 miss 时经 directSend（koishi bot）发出', async () => {
    const directSend = vi.fn().mockResolvedValue(undefined)
    const sender = new RouteMessageSender(new OutboundRouteRegistry(), new HabitatSendRegistry(), directSend)

    await sender.send({
      target: { platform: 'onebot', botId: 'bot1', channelId: 'g-cold', habitatId: 'g-cold' },
      content: '冷启动回复',
    })
    expect(directSend).toHaveBeenCalledWith(
      { platform: 'onebot', botId: 'bot1', channelId: 'g-cold', guildId: undefined },
      '冷启动回复',
    )
  })

  it('habitat 注册表命中时优先走注册表（不触发直发）；无兜底且全 miss 仍抛错', async () => {
    const habitatSend = vi.fn().mockResolvedValue(undefined)
    const habitatRoutes = new HabitatSendRegistry()
    habitatRoutes.register({ platform: 'onebot', channelId: 'g1', send: habitatSend })
    const directSend = vi.fn()
    const sender = new RouteMessageSender(new OutboundRouteRegistry(), habitatRoutes, directSend)

    await sender.send({ target: { platform: 'onebot', channelId: 'g1' }, content: 'x' })
    expect(habitatSend).toHaveBeenCalledWith('x')
    expect(directSend).not.toHaveBeenCalled()

    // 无 directSend 兜底 + 目标缺 platform/channelId → 仍可观测失败
    const bare = new RouteMessageSender(new OutboundRouteRegistry(), new HabitatSendRegistry())
    await expect(bare.send({ target: {}, content: 'x' })).rejects.toThrow(/Outbound route not found/)
  })
})
