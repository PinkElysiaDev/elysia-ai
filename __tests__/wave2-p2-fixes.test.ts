import { describe, expect, it, vi } from 'vitest'
import type { DialogueMessage } from '@elysia-ai/core'
import { DEFAULT_INSTANT_RULES, InstantEngine } from '@elysia-ai/trigger'
import { encodeResponsesRequest } from '../packages/@elysia-ai/protocol-responses/src/encode.js'
import { encodeChatCompletionsRequest } from '../packages/@elysia-ai/protocol-openai/src/encode.js'
import { toMaheshvaraMessages } from '../packages/@elysia-ai/model-gateway/src/providers/maheshvara-bridge.js'
import { MemoryTriggerTaskRepository, TriggerManager } from '../packages/@elysia-ai/behavior/src/trigger-manager.js'
import { createTriggerToolEntry } from '../packages/@elysia-ai/behavior/src/trigger-tool.js'
import { createWakeTools, createWakeToolState, resolveWakeOutput } from '../packages/@elysia-ai/behavior/src/tools.js'
import { createBehaviorPluginRuntime } from '../packages/@elysia-ai/behavior/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/index.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/index.js'
import type { TriggerTask, CoreEventMap, Stimulus } from '../packages/@elysia-ai/core/src/index.js'

/**
 * Wave 2 P2 修复回归（2026-09-08 第二轮）：
 * - W2-6 空 tool_call_id 的 function_call/output 配对合成（responses + openai encode）
 * - W2-7 trigger 工具 list/get 的 habitat 过滤
 * - W2-8 resume 不再隐式 enable
 * - W2-9/W2-10 即时冷却按 habitat 隔离 + 默认规则 3s 冷却
 * - W2-11 trigger 工具 actor 归因锁定（metadata.wakeActor）
 * - W2-12 非 instant 唤醒的记忆/羁绊归因降级（habitat 档）
 * - W2-13 空 lifeId 哨兵不再点火
 * - W2-15 send_reply 段数/单段长度上限
 */

const logger = { info() {}, debug() {}, warn() {}, error() {} }

describe('W2-6：空 tool_call_id 的配对合成（防上游 400）', () => {
  /** assistant 空 id 工具调用 + 空 toolCallId 的 tool 消息（历史上必失配的形态）。 */
  const orphanToolMessages: DialogueMessage[] = [
    { role: 'user', content: '看下天气' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: '', type: 'function', name: 'get_weather', arguments: '{"city":"上海"}' }],
    },
    { role: 'tool', toolCallId: '', name: 'get_weather', content: '{"temp":26}' },
  ]

  it('responses encode：function_call 与 function_call_output 的 call_id 一致（合成回填）', () => {
    const req = { model: 'm', messages: toMaheshvaraMessages(orphanToolMessages), max_output_tokens: 100 }
    const body = encodeResponsesRequest(req)
    const input = body['input'] as Array<Record<string, unknown>>
    const fnCall = input.find((item) => item['type'] === 'function_call')
    const fnOutput = input.find((item) => item['type'] === 'function_call_output')
    expect(fnCall).toBeTruthy()
    expect(fnOutput).toBeTruthy()
    // msgIndex=1 的 assistant 第 0 个 call → call_1_0；tool 消息回填同一合成 id
    expect(fnCall!['call_id']).toBe('call_1_0')
    expect(fnOutput!['call_id']).toBe(fnCall!['call_id'])
    expect(fnOutput!['output']).toBe('{"temp":26}')
  })

  it('openai encode：assistant tool_calls[].id 与 role:"tool" 的 tool_call_id 一致', () => {
    const req = { model: 'm', messages: toMaheshvaraMessages(orphanToolMessages), max_output_tokens: 100 }
    const body = encodeChatCompletionsRequest(req)
    const msgs = body['messages'] as Array<Record<string, unknown>>
    const assistantMsg = msgs.find((m) => m['role'] === 'assistant') as { tool_calls?: Array<{ id?: string }> } | undefined
    const toolMsg = msgs.find((m) => m['role'] === 'tool')
    expect(assistantMsg?.tool_calls?.[0]?.id).toBe('call_1_0')
    expect(toolMsg!['tool_call_id']).toBe(assistantMsg?.tool_calls?.[0]?.id)
  })

  it('responses encode：无前序合成可回填时仍降级 user 文本（不误造配对）', () => {
    // assistant 携带真实 id；tool 消息空 id → 不该把真实 id 抢给空 tool 输出
    const messages: DialogueMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'real-1', type: 'function', name: 'get_weather', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: '', name: 'get_weather', content: 'orphan' },
    ]
    const req = { model: 'm', messages: toMaheshvaraMessages(messages), max_output_tokens: 100 }
    const body = encodeResponsesRequest(req)
    const input = body['input'] as Array<Record<string, unknown>>
    const fnOutput = input.find((item) => item['type'] === 'function_call_output')
    expect(fnOutput).toBeUndefined()
    const degraded = input.find((item) => item['role'] === 'user') as { content?: Array<{ text?: string }> } | undefined
    expect(degraded?.content?.[0]?.text).toContain('[tool_output_missing_call_id] orphan')
  })
})

describe('W2-7：trigger 工具读操作的 habitat 过滤', () => {
  async function setup(admin: boolean) {
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: vi.fn(),
      checkAdmin: async () => admin,
      now: () => 1_700_000_000_000,
    })
    const own = await manager.create({ name: 'own', habitatId: 'g1', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o' }) as TriggerTask
    const other = await manager.create({ name: 'other', habitatId: 'g2', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o' }) as TriggerTask
    const broadcast = await manager.create({ name: 'bcast', habitatId: '*', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o' }) as TriggerTask
    const entry = createTriggerToolEntry({ manager, habitatId: 'g1', actor: { userId: 'u1' } })
    return { entry, own, other, broadcast }
  }

  it('非 admin：list 只见本 habitat（含广播任务）；get 他 habitat 任务 forbidden', async () => {
    const { entry, own, other, broadcast } = await setup(false)
    const listed = await entry.execute({ action: 'list' }) as Array<{ id: string }>
    expect(listed.map((task) => task.id).sort()).toEqual([broadcast.id, own.id].sort())

    const denied = await entry.execute({ action: 'get', id: other.id })
    expect(denied).toMatchObject({ ok: false, code: 'trigger-forbidden' })
  })

  it('admin：list/get 不受 habitat 过滤影响', async () => {
    const { entry, own, other, broadcast } = await setup(true)
    const listed = await entry.execute({ action: 'list' }) as Array<{ id: string }>
    expect(listed).toHaveLength(3)
    const got = await entry.execute({ action: 'get', id: other.id }) as TriggerTask
    expect(got.id).toBe(other.id)
    expect(got.name).toBe('other')
    expect(own.id).toBeTruthy()
    expect(broadcast.id).toBeTruthy()
  })
})

describe('W2-8：resume 不再隐式 enable', () => {
  it('disabled 任务 resume 报错不复活；enabled 任务 resume 正常', async () => {
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 20 }),
      fire: vi.fn(),
      checkAdmin: async () => true,
      now: () => 1_700_000_000_000,
    })
    const created = await manager.create({ name: 't', habitatId: 'g1', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o' }) as TriggerTask
    await manager.update(created.id, { enabled: false })

    const denied = await manager.resume(created.id)
    expect(denied).toMatchObject({ error: 'task is disabled; use enable instead' })
    const stored = await manager.get(created.id)
    expect(stored?.enabled).toBe(false)  // 不复活
    expect(stored?.state.status).toBe('paused')

    await manager.update(created.id, { enabled: true })
    const resumed = await manager.resume(created.id) as TriggerTask
    expect(resumed.state.status).toBe('waiting')
  })
})

describe('W2-9/W2-10：即时冷却按 habitat 隔离 + 默认规则 3s 冷却', () => {
  it('群 A 触发冷却中，群 B 同规则仍可触发', () => {
    const rule = {
      id: 'r1', name: 'r', enabled: true, eventKey: 'message',
      action: { type: 'llm' as const }, cooldownMs: 10_000,
    }
    const engine = new InstantEngine({ getConfig: () => [rule], now: () => 20_000 })
    const first = engine.match({ key: 'message', timestamp: 0, habitatId: 'A', payload: {} } as never)
    expect(first).toBeDefined()
    engine.consumeCooldown(first!.item, 'A')

    expect(engine.match({ key: 'message', timestamp: 1, habitatId: 'A', payload: {} } as never)).toBeUndefined()
    expect(engine.match({ key: 'message', timestamp: 2, habitatId: 'B', payload: {} } as never)).toBeDefined()
  })

  it('默认即时规则（被@必应/私聊必应）自带 3000ms 冷却', () => {
    expect(DEFAULT_INSTANT_RULES).toHaveLength(2)
    for (const rule of DEFAULT_INSTANT_RULES) {
      expect(rule.cooldownMs).toBe(3000)
    }
  })
})

describe('W2-11/W2-12/W2-13：唤醒归因与哨兵', () => {
  let runtime: Runtime
  let behaviorRuntime: { dispose(): void, service: { fireTrigger(request: Record<string, unknown>): void, getTriggerManager(): unknown } }

  function setup(options: { cognition?: unknown, checkTriggerAdmin?: (actor: { userId?: string }) => Promise<boolean> } = {}) {
    runtime = createDefaultRuntime(logger)
    behaviorRuntime = createBehaviorPluginRuntime({
      runtime: {
        context: runtime.context,
        receiveStimulus: (stimulus) => { void runtime.receiveStimulus(stimulus) },
      },
      cognition: options.cognition as never,
      checkTriggerAdmin: options.checkTriggerAdmin as never,
      config: { enableReply: true },
      logger,
    })
    return behaviorRuntime.service
  }

  async function startRuntime() {
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-w2', type: 'elysia-default' }],
    })
    await runtime.start()
  }

  async function waitFor<T>(probe: () => T | undefined, what: string): Promise<T> {
    const deadline = Date.now() + 5_000
    for (;;) {
      const value = probe()
      if (value !== undefined) return value
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  /** 等待一条 behavior.instruction 并取 dialogue task 的 metadata。 */
  async function wakeAndGrabTask(source: 'instant' | 'scheduled', events?: unknown[]) {
    const instructions: CoreEventMap['behavior.instruction'][] = []
    const plans: CoreEventMap['behavior.execution.plan.created'][] = []
    const stimuli: Stimulus[] = []
    const offI = runtime.context.eventBus.on('behavior.instruction', (payload) => instructions.push(payload))
    const offP = runtime.context.eventBus.on('behavior.execution.plan.created', (payload) => plans.push(payload))
    const offS = runtime.context.eventBus.on('stimulus.received', ({ stimulus }) => stimuli.push(stimulus))

    behaviorRuntime.service.fireTrigger({
      lifeId: 'life-w2',
      habitatId: 'g-w2',
      source,
      reason: 'w2-test',
      ...(events ? { events } : {}),
    })

    await waitFor(() => (instructions.length > 0 ? instructions[0] : undefined), 'behavior.instruction')
    const action = instructions[0].instruction.actions[0] as unknown as {
      task: { metadata: Record<string, unknown> }
    }
    offI()
    offP()
    offS()
    return { taskMetadata: action.task.metadata, plans, stimulus: stimuli[0] }
  }

  it('W2-11：trigger 工具权限用 metadata.wakeActor（点火时刻锁定），不用组装时刻 lastEvent', async () => {
    // cognition 滚动窗口里最后说话的是 bob（旧实现会把权限归因漂移到 bob）；
    // 点火事件里最后说话的是 alice（wakeActor 锁定 alice）。
    const cognitionStub = {
      getRecentEvents: () => [{ key: 'message', timestamp: 1, habitatId: 'g-w2', actorId: 'bob', payload: {} }],
      buildFeed: () => [],
    }
    setup({
      cognition: cognitionStub,
      checkTriggerAdmin: async (actor) => actor.userId === 'alice',
    })
    await startRuntime()

    const { taskMetadata, stimulus } = await wakeAndGrabTask('instant', [
      { key: 'mention', timestamp: 1, habitatId: 'g-w2', actorId: 'alice', payload: {} },
    ])
    // 合成刺激带 wakeActor 快照
    expect((stimulus.metadata as Record<string, unknown>).wakeActor).toMatchObject({ userId: 'alice' })

    // trigger 工具以 alice 判权 → list 放行（若归因漂移到 bob 则 forbidden）
    const tools = (taskMetadata['agentic'] as { tools: Array<{ definition: { name: string }, execute(args: unknown): Promise<unknown> }> }).tools
    const triggerTool = tools.find((tool) => tool.definition.name === 'trigger')
    expect(triggerTool).toBeTruthy()
    const listed = await triggerTool!.execute({ action: 'list' })
    expect(Array.isArray(listed)).toBe(true)
  })

  it('W2-12：scheduled 唤醒的 memory request scope 为 habitat（actorId 不再错配到最后说话者）', async () => {
    setup()
    await startRuntime()

    const { taskMetadata, plans } = await wakeAndGrabTask('scheduled', [
      { key: 'message', timestamp: 1, habitatId: 'g-w2', actorId: 'mallory', payload: {} },
    ])
    const plan = plans[0].plan
    const memoryAction = plan.actions.find((action) => action.type === 'memory-update')
    const bondAction = plan.actions.find((action) => action.type === 'bond-update')
    expect((memoryAction!.payload as Record<string, unknown>)['request']).toMatchObject({
      scope: 'habitat',
      actorId: undefined,
    })
    expect((bondAction!.payload as Record<string, unknown>)['request']).toMatchObject({
      targetType: 'habitat',
      targetId: 'g-w2',
    })
    // 对话任务的 metadata.actorId 同样不在 scheduled 时取 lastEvent
    expect(taskMetadata['actorId']).toBeUndefined()

    // 对照：instant 唤醒仍归因 actor 档
    const instant = await wakeAndGrabTask('instant', [
      { key: 'mention', timestamp: 2, habitatId: 'g-w2', actorId: 'alice', payload: {} },
    ])
    const instantMemory = instant.plans[0].plan.actions.find((action) => action.type === 'memory-update')
    expect((instantMemory!.payload as Record<string, unknown>)['request']).toMatchObject({
      scope: 'actor',
      actorId: 'alice',
    })
  })

  it('W2-13：无法解析 lifeId 时 fire 回调不点火（空串哨兵根治）', async () => {
    const received: unknown[] = []
    const warns: string[] = []
    const bus = {
      on: vi.fn(() => () => {}),
      emit: vi.fn(async () => {}),
    }
    const behavior = createBehaviorPluginRuntime({
      runtime: {
        context: {
          eventBus: bus as never,
          // 主链单轨：装配需要管线钩子；本用例不驱动主链，桩即可
          pipeline: { registerHook: () => () => {} } as never,
        },
        receiveStimulus: (stimulus) => { received.push(stimulus) },
      },
      config: { enableReply: true },
      logger: { ...logger, warn: (...args: unknown[]) => warns.push(String(args[0])) },
    })
    const manager = behavior.service.getTriggerManager() as TriggerManager
    // habitat 无任何活跃 scope、任务未带 lifeId → effectiveLifeId 解析为 ''
    const created = await manager.create({
      name: 'orphan', habitatId: 'g-nowhere',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p', ownerKey: 'o',
    }) as TriggerTask
    const result = await manager.fire(created.id)
    expect(result).toMatchObject({ id: created.id })  // fire 本身成功返回 task
    expect(received).toHaveLength(0)  // 但不点火不投递
    expect(warns.some((line) => line.includes('trigger fire skipped: no lifeId resolved'))).toBe(true)
    behavior.dispose()
  })
})

describe('W2-15：send_reply 段数与单段长度上限', () => {
  it('超过 5 条发言拒绝追加（too-many-segments）', async () => {
    const state = createWakeToolState()
    const tools = createWakeTools({ state, getRecentPacks: () => [], renderPack: () => '' })
    const sendReply = tools.find((tool) => tool.definition.name === 'send_reply')!
    for (let i = 0; i < 5; i++) {
      expect(await sendReply.execute({ text: `第${i}条` })).toMatchObject({ ok: true })
    }
    const sixth = await sendReply.execute({ text: '第六条' })
    expect(sixth).toMatchObject({ ok: false, code: 'too-many-segments', message: '最多 5 条发言' })
    const output = resolveWakeOutput(state, { rounds: 1, stopReason: 'done' } as never)
    expect(output.segments).toHaveLength(5)
  })

  it('单段超 2000 字符截断到 2000 并附省略号（仍发送）', async () => {
    const state = createWakeToolState()
    const tools = createWakeTools({ state, getRecentPacks: () => [], renderPack: () => '' })
    const sendReply = tools.find((tool) => tool.definition.name === 'send_reply')!
    const result = await sendReply.execute({ text: 'x'.repeat(2500) })
    expect(result).toMatchObject({ ok: true, sent: 1 })
    const output = resolveWakeOutput(state, { rounds: 1, stopReason: 'done' } as never)
    expect(output.segments[0].length).toBe(2002)  // 2000 + '……'
    expect(output.segments[0].endsWith('……')).toBe(true)
  })
})
