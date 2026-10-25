import { describe, expect, it, vi } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type { CoreEventMap, MemoryEntry } from '../packages/@elysia-ai/core/src/index.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'
import { createPerceptionPluginRuntime } from '../packages/@elysia-ai/perception/src/index.js'
import { MemoryTriggerTaskRepository, TriggerManager } from '../packages/@elysia-ai/behavior/src/trigger-manager.js'
import { createTriggerToolEntry } from '../packages/@elysia-ai/behavior/src/trigger-tool.js'
import { createBehaviorExecutionPlan } from '../packages/@elysia-ai/behavior/src/execution-plan.js'
import {
  DefaultMemoryService,
  MemoryMemoryRepository,
  RuleBasedMemoryContextProvider,
} from '../packages/@elysia-ai/memory/src/index.js'
import { MemoryConversationStore } from '../packages/elysia-ai-runtime/src/store/memory-conversation-store.js'
import { DefaultHomeostasisService } from '../packages/elysia-ai-runtime/src/homeostasis/index.js'
import type { TriggerTask } from '../packages/@elysia-ai/core/src/index.js'

/**
 * Wave 3 P3 批量修复回归（2026-09-08 第二轮）：
 * - observatory：body kind 恢复、statusFromEvent 取末段、sanitize DAG、scheduledTaskId 死字段删除
 * - perception：合成触发刺激跳过分析
 * - homeostasis：旧文档退役字段剥离
 * - memory：shared 线程记忆不泄漏到 habitat 级、archived 不再被 merge 复活
 * - runtime：MemoryConversationStore 外层 scope 上限
 * - behavior：execution-plan memory scope 提示与 ownerType 对齐（habitat）
 * - trigger：list limit 0/负数回退默认、pause 到期保留 runCount、运行中写竞态防御
 * - body：bot-sent 内容纯文本化
 */

const logger = { info() {}, debug() {}, warn() {}, error() {} }

describe('W3 observatory：kind/status/sanitize/死字段', () => {
  it('body.message.* 事件归 kind=body；statusFromEvent 取事件名最后一段', () => {
    const service = new DefaultObservatoryService(100)
    const sent = service.recordEvent('body.message.sent', { stimulusId: 's1' })
    expect(sent.kind).toBe('body')
    expect(sent.status).toBe('sent')
    const failed = service.recordEvent('body.message.failed', {})
    expect(failed.status).toBe('failed')

    // 三段以上事件此前固定取第二段（全落 default）
    expect(service.recordEvent('bond.relevance.selection.completed', {}).status).toBe('completed')
    expect(service.recordEvent('dialogue.generation.requested', {}).status).toBe('requested')
    expect(service.recordEvent('memory.context.selected', {}).status).toBe('selected')
  })

  it('scheduledTaskId 死字段已删除（scheduler 退役）', () => {
    const service = new DefaultObservatoryService(100)
    const rec = service.recordEvent('behavior.trigger.fired', { taskId: 't1' })
    expect(rec.taskId).toBe('t1')
    expect('scheduledTaskId' in rec).toBe(false)
  })

  it('sanitize：DAG 同对象多处引用不再误判 Circular；真环仍截断', () => {
    const service = new DefaultObservatoryService(100)
    const shared = { note: 'x' }
    const dag = service.recordEvent('runtime.started', { nested1: shared, nested2: shared })
    expect(dag.metadata?.['nested1']).toEqual({ note: 'x' })
    expect(dag.metadata?.['nested2']).toEqual({ note: 'x' })  // 旧实现此处为 '[Circular]'

    const ring: Record<string, unknown> = { note: 'r' }
    ring['self'] = ring
    const rec = service.recordEvent('runtime.started', { ring })
    expect(((rec.metadata?.['ring'] as Record<string, unknown>)['self'])).toBe('[Circular]')
  })
})

describe('W3 perception：合成触发刺激跳过分析', () => {
  it('metadata.triggerSource 的刺激不产 perception.completed；普通刺激照常', async () => {
    const { ELYSIA_PIPELINE_STAGES, PipelineRunner, RequestContextStore } = await import('../packages/@elysia-ai/core/src/index.js')
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const completed: unknown[] = []
    eventBus.on('perception.completed', (payload) => completed.push(payload))
    // 主链单轨：perception 以管线钩子装配，测试直接驱动 perception 阶段
    const pipeline = new PipelineRunner<unknown>({ onError: () => {} })
    for (const stage of ELYSIA_PIPELINE_STAGES) pipeline.registerStage(stage)
    const plugin = createPerceptionPluginRuntime({
      runtime: { context: { eventBus, pipeline } } as never,
      config: { enabledIntentClassify: true, enabledEntityExtract: true, enabledSentiment: true },
      logger,
    })

    async function drive(stimulus: Record<string, unknown>) {
      const contexts = new RequestContextStore()
      const pctx = contexts.create({ id: String(stimulus['id']), core: { stimulus } })
      await pipeline.run(pctx, { stages: ['perception'] })
    }

    await drive({
      id: 'syn-1', type: 'addressing', timestamp: 1, habitatId: 'g1', lifeId: 'l1',
      payload: { content: '', triggerSource: 'instant' },
      metadata: { triggerSource: 'instant' },
    })
    expect(completed).toHaveLength(0)

    await drive({
      id: 'real-1', type: 'utterance', timestamp: 2, habitatId: 'g1', lifeId: 'l1',
      payload: { content: '你好' }, metadata: {},
    })
    expect(completed).toHaveLength(1)
    plugin.dispose()
  })
})

describe('W3 homeostasis：旧文档退役字段剥离', () => {
  it('getState/update 归一只挑已知字段（responseThreshold 不再永久残留）', async () => {
    const { MemoryStateRepository } = await import('../packages/elysia-ai-runtime/src/store/memory-state-repository.js')
    const repo = new MemoryStateRepository<Record<string, unknown>>()
    await repo.save('life-legacy', {
      lifeInstanceId: 'life-legacy', timestamp: 1,
      energy: 0.5, mood: 0, sociability: 0.5, curiosity: 0.5,
      responseThreshold: 0.4,  // 旧 schema 残留字段
    })
    const service = new DefaultHomeostasisService(repo as never, new MemoryEventBus<CoreEventMap>())

    const state = await service.getState('life-legacy')
    expect(state).toMatchObject({ energy: 0.5, mood: 0 })
    expect(state && 'responseThreshold' in state).toBe(false)

    const result = await service.update({
      id: 'req-1', lifeId: 'life-legacy', reason: 'test', createdAt: Date.now(),
      delta: { energy: 0.1 },
    })
    expect(result.state).toMatchObject({ energy: 0.6 })
    expect('responseThreshold' in result.state).toBe(false)
    const persisted = await repo.getByLifeInstanceId('life-legacy')
    expect(persisted && 'responseThreshold' in persisted).toBe(false)
  })
})

describe('W3 memory：可见性与归档合并', () => {
  it('shared 线程记忆不泄漏到 habitat 级请求（无 threadId 不可见）', async () => {
    const repository = new MemoryMemoryRepository()
    const provider = new RuleBasedMemoryContextProvider(repository, new MemoryEventBus<CoreEventMap>(), { defaultLimit: 5 })
    const entry: MemoryEntry = {
      id: 'memory-thread-shared', lifeId: 'life-w3', scope: 'thread', kind: 'episodic', status: 'active',
      content: 'thread secret plan', actorId: 'a1', habitatId: 'h1', threadId: 't1',
      ownerType: 'thread', ownerId: 't1', visibility: 'shared',
      importance: 0.9, confidence: 0.9, createdAt: Date.now(), updatedAt: Date.now(), accessCount: 0,
    }
    await repository.save(entry)

    const habitatLevel = await provider.buildContext({ lifeId: 'life-w3', habitatId: 'h1', content: 'plan', limit: 5 })
    expect(habitatLevel.items.map((item) => item.entry.id)).not.toContain('memory-thread-shared')

    const threadLevel = await provider.buildContext({ lifeId: 'life-w3', habitatId: 'h1', threadId: 't1', content: 'plan', limit: 5 })
    expect(threadLevel.items.map((item) => item.entry.id)).toContain('memory-thread-shared')
  })

  it('archived 记忆不再被同刺激更新 merge 复活', async () => {
    const repository = new MemoryMemoryRepository()
    const service = new DefaultMemoryService(repository, new MemoryEventBus<CoreEventMap>())
    const first = await service.update({
      id: 'u1', stimulusId: 'stim-arch', lifeId: 'life-w3', reason: 'r',
      content: 'first', createdAt: 1, kind: 'episodic', skipAttribution: true,
    })
    expect(first.created).toBe(true)

    await repository.update(first.entry.id, { status: 'archived', updatedAt: 2 })
    const second = await service.update({
      id: 'u2', stimulusId: 'stim-arch', lifeId: 'life-w3', reason: 'r',
      content: 'second', createdAt: 3, kind: 'episodic', skipAttribution: true,
    })
    expect(second.created).toBe(true)  // 新建而非合并回归档条目
    const archived = (await repository.listByStimulusId('stim-arch')).find((item) => item.id === first.entry.id)
    expect(archived?.status).toBe('archived')  // 原条目保持归档
  })
})

describe('W3 runtime：MemoryConversationStore 外层 scope 上限', () => {
  it('超过 300 个 scope 时最旧的被淘汰（不再无界增长）', () => {
    const store = new MemoryConversationStore()
    for (let i = 0; i < 301; i++) {
      store.append(`scope-${i}`, { role: 'user', content: 'x', timestamp: i } as never)
    }
    expect(store.getRecent('scope-0')).toHaveLength(0)  // 第 301 个 scope 挤掉最旧的
    expect(store.getRecent('scope-1')).toHaveLength(1)
    expect(store.getRecent('scope-300')).toHaveLength(1)
  })
})

describe('W3 behavior：execution-plan memory scope 与 ownerType 对齐', () => {
  it('无 actorId 的刺激 memory request scope 为 habitat（不再是 life）', () => {
    const plan = createBehaviorExecutionPlan({
      stimulus: { id: 's1', habitatId: 'g1', payload: {}, actorId: undefined } as never,
      lifeId: 'life-w3',
      plan: {
        scope: { type: 'habitat', key: 'g1' },
        sourceStimulusIds: ['s1'],
        mode: 'internal-update-only',
        plannerSource: 'program',
        reason: 'w3-test',
        shouldEnterDialogue: false,
        shouldUpdateMemory: true,
        shouldUpdateBond: false,
        shouldUpdateHomeostasis: false,
        shouldScheduleFollowup: false,
      } as never,
      currentUserContent: 'summary',
      now: 1,
    })
    const memoryAction = plan.actions.find((action) => action.type === 'memory-update')
    expect((memoryAction!.payload as Record<string, unknown>)['request']).toMatchObject({ scope: 'habitat' })
  })
})

describe('W3 trigger：limit 回退 / pause 保留历史 / 运行中写竞态', () => {
  function makeManager(fire?: TriggerManager['fire'], nowFn: () => number = () => 1_700_000_000_000) {
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 200 }),
      fire: fire ?? vi.fn(),
      checkAdmin: async () => true,
      now: nowFn,
      logger,
    })
    return manager
  }

  it('list limit 0/负数回退默认 20（此前 Math.max(1,…) 只给 1 条）', async () => {
    const manager = makeManager()
    for (let i = 0; i < 25; i++) {
      await manager.create({ name: `t${i}`, habitatId: 'g1', condition: { type: 'interval', everyMinutes: 10 + i }, prompt: 'p', ownerKey: 'o' })
    }
    const entry = createTriggerToolEntry({ manager, habitatId: 'g1', actor: { userId: 'admin' } })
    expect(await entry.execute({ action: 'list' })).toHaveLength(20)
    expect(await entry.execute({ action: 'list', limit: 0 })).toHaveLength(20)
    expect(await entry.execute({ action: 'list', limit: -5 })).toHaveLength(20)
    expect(await entry.execute({ action: 'list', limit: 3 })).toHaveLength(3)
  })

  it('pause_until 到期恢复与 update/enable/resume 一致：runCount/lastRunAt 保留', async () => {
    let now = 1_700_000_000_000
    const manager = makeManager(undefined, () => now)
    const created = await manager.create({ name: 't', habitatId: 'g1', condition: { type: 'interval', everyMinutes: 1 }, prompt: 'p', ownerKey: 'o' }) as TriggerTask

    now += 61_000
    await manager['harvest']()  // 跑一轮
    const ran = await manager.get(created.id)
    expect(ran?.state.runCount).toBe(1)

    await manager.pauseUntil(created.id, now + 120_000)
    now += 130_000
    await manager['harvest']()  // pause 到期恢复
    const resumed = await manager.get(created.id)
    expect(resumed?.state.status).toBe('waiting')
    expect(resumed?.state.runCount).toBe(1)  // 恢复不清零
  })

  it('运行中任务被 pause 抢先写：最终状态写被放弃（不覆盖 paused）', async () => {
    const BASE = 1_700_000_000_000
    let now = BASE
    const store = new MemoryTriggerTaskRepository()
    const warns: string[] = []
    const manager = new TriggerManager({
      store,
      config: () => ({ enabled: true, adminWhitelist: [], maxTasksPerOwner: 200 }),
      fire: ({ task }) => {
        // 同步模拟并发 pause_until：claim 置 running 后、最终 save 前被抢先改写
        const internal = (store as unknown as { store: Map<string, TriggerTask> }).store.get(task.id)
        if (internal) {
          internal.state = { ...internal.state, status: 'paused', pausedUntil: now + 999_999, nextRunAt: now + 999_999 }
        }
      },
      checkAdmin: async () => true,
      now: () => now,
      logger: { ...logger, warn: (...args: unknown[]) => warns.push(String(args[0])) },
    })
    const task: TriggerTask = {
      id: 'race-1', name: 'x', enabled: true, habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 }, prompt: 'p', ownerKey: 'o',
      createdAt: BASE, updatedAt: BASE,
      state: { status: 'waiting', nextRunAt: BASE + 60_000, occurrenceKey: 'k1', lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null },
    }
    await store.save(task)
    await manager['runTask'](task, BASE + 61_000)

    const final = await store.get('race-1')
    expect(final?.state.status).toBe('paused')  // 最终写未回滚 pause
    expect(warns.some((line) => line.includes('discarding final state write'))).toBe(true)
  })
})

describe('W3 body：bot-sent 内容纯文本化', () => {
  it('session.elements 存在时 bot-sent 刺激 content 为纯文本（不带元素标记）', async () => {
    const { KoishiBodyAdapter } = await import('../packages/elysia-ai-body/src/adapters/koishi/koishi-body-adapter.js')
    const listeners = new Map<string, (session: unknown) => unknown>()
    const ctx = {
      logger: () => logger,
      on: (event: string, listener: (session: unknown) => unknown) => {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      },
    } as never
    const received: Array<{ payload?: { content?: unknown } }> = []
    const adapter = new KoishiBodyAdapter(ctx, { receiveStimulus: (s: never) => { received.push(s as never); return Promise.resolve() } } as never, {})
    adapter.registerListeners()
    const handler = listeners.get('message')!

    await handler({
      userId: 'bot1', selfId: 'bot1', platform: 'onebot', channelId: 'c1', timestamp: 1,
      content: '<at id="42"/>早上好',
      elements: [
        { type: 'at', attrs: { id: '42', name: '某人' } },
        { type: 'text', attrs: { content: '早上好' } },
      ],
      bot: { user: { name: 'me' } },
    })
    expect(received).toHaveLength(1)
    expect(received[0].payload?.content).toBe('@某人早上好')

    // 无 elements 时回退 session.content 原样
    await handler({
      userId: 'bot1', selfId: 'bot1', platform: 'onebot', channelId: 'c2', timestamp: 2,
      content: 'plain',
      bot: { user: { name: 'me' } },
    })
    expect(received[1]?.payload?.content).toBe('plain')
  })
})
