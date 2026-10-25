import { describe, expect, it, vi } from 'vitest'
import {
  afterTriggerRun,
  computeNextOccurrence,
  initialTriggerState,
  resolveMisfire,
  validateTriggerCondition,
} from '../packages/@elysia-ai/trigger/src/trigger-planner.js'
import { normalizeTriggerCondition } from '../packages/@elysia-ai/trigger/src/trigger-task.js'
import type { TriggerTask } from '../packages/@elysia-ai/trigger/src/trigger-task.js'
import { MemoryTriggerTaskRepository, TriggerManager } from '../packages/@elysia-ai/behavior/src/trigger-manager.js'
import { createTriggerToolEntry } from '../packages/@elysia-ai/behavior/src/trigger-tool.js'

const BASE = 1_700_000_000_000

function task(overrides: Partial<TriggerTask> = {}): TriggerTask {
  return {
    id: 't1',
    name: '测试任务',
    enabled: true,
    habitatId: 'g1',
    condition: { type: 'interval', everyMinutes: 30 },
    prompt: '看看群里在聊什么',
    ownerKey: 'onebot:bot1:admin',
    createdAt: BASE,
    updatedAt: BASE,
    state: {
      status: 'waiting', nextRunAt: null, occurrenceKey: null,
      lastRunAt: null, runCount: 0, lastError: null, pausedUntil: null,
    },
    ...overrides,
  }
}

describe('planner 时间数学', () => {
  const ctx = { taskAnchor: BASE, taskId: 't1' }

  it('interval 锚点模运算：从锚点推算，运行延迟不漂移', () => {
    const condition = { type: 'interval' as const, everyMinutes: 30, anchorAt: new Date(BASE).toISOString() }
    // after = 锚点 + 45min → 下一个是锚点+60min
    const first = computeNextOccurrence(condition, BASE + 45 * 60_000, ctx)
    expect(first?.at).toBe(BASE + 60 * 60_000)
    // 锚点 + 61min → 锚点 + 90min（相位保持）
    const second = computeNextOccurrence(condition, BASE + 61 * 60_000, ctx)
    expect(second?.at).toBe(BASE + 90 * 60_000)
  })

  it('once：过期返回 null（completed 语义）', () => {
    const condition = { type: 'once' as const, at: new Date(BASE + 60_000).toISOString() }
    expect(computeNextOccurrence(condition, BASE, ctx)?.at).toBe(BASE + 60_000)
    expect(computeNextOccurrence(condition, BASE + 120_000, ctx)).toBeNull()
  })

  it('cron：cron-parser 驱动', () => {
    const condition = { type: 'cron' as const, expression: '0 9 * * *', timezone: 'UTC' }
    const next = computeNextOccurrence(condition, BASE, ctx)
    expect(next).not.toBeNull()
    const date = new Date(next!.at)
    expect(date.getUTCHours()).toBe(9)
    expect(date.getUTCMinutes()).toBe(0)
    expect(next!.at).toBeGreaterThan(BASE)
  })

  it('cron 数组表达式：取全部表达式中最近的下次时刻，幂等键带表达式索引', () => {
    // BASE 是 2023-11-14T22:13:20Z（周二）；UTC 下一条 9:00 在次日，18:30 也在次日 → 取 9:00
    const morningFirst = computeNextOccurrence(
      { type: 'cron', expression: ['0 18 * * *', '0 9 * * *'], timezone: 'UTC' },
      BASE,
      ctx,
    )
    expect(morningFirst).not.toBeNull()
    expect(new Date(morningFirst!.at).getUTCHours()).toBe(9)
    expect(morningFirst!.occurrenceKey).toContain(':cron:1:')

    // 单条表达式仍兼容字符串形态
    const single = computeNextOccurrence({ type: 'cron', expression: '0 9 * * *', timezone: 'UTC' }, BASE, ctx)
    expect(single).not.toBeNull()

    // 混入非法表达式：跳过非法、保留合法
    const withBad = computeNextOccurrence(
      { type: 'cron', expression: ['not-a-cron', '0 9 * * *'], timezone: 'UTC' },
      BASE,
      ctx,
    )
    expect(withBad).not.toBeNull()
    expect(new Date(withBad!.at).getUTCHours()).toBe(9)

    // 全部非法 → 无解
    expect(computeNextOccurrence({ type: 'cron', expression: ['bad', 'also bad'] }, BASE, ctx)).toBeNull()

    // normalize 归一与去重
    const normalized = normalizeTriggerCondition({ type: 'cron', expression: ['0 9 * * *', '0 9 * * *', 'garbage-ok'] })
    expect('error' in normalized).toBe(false)
    // validate 数组逐条校验
    expect(validateTriggerCondition({ type: 'cron', expression: ['0 9 * * *', 'not-a-cron'] })).toMatch(/invalid cron/)
  })

  it('afterRun：once 完结、interval 重排', () => {
    const once = afterTriggerRun(task({ condition: { type: 'once', at: new Date(BASE + 60_000).toISOString() } }), BASE + 60_000)
    expect(once.status).toBe('completed')
    expect(once.runCount).toBe(1)

    const interval = afterTriggerRun(task(), BASE + 30 * 60_000)
    expect(interval.status).toBe('waiting')
    expect(interval.nextRunAt).toBe(BASE + 60 * 60_000)
  })

  it('misfire：1 分钟内视为正常延迟直接跑；超过按策略', () => {
    expect(resolveMisfire({ type: 'interval', everyMinutes: 30 }, BASE, BASE + 30_000)).toBe('fire')
    expect(resolveMisfire({ type: 'interval', everyMinutes: 30, misfire: 'skip' }, BASE, BASE + 300_000)).toBe('skip')
    expect(resolveMisfire({ type: 'interval', everyMinutes: 30, misfire: 'fire_once' }, BASE, BASE + 300_000)).toBe('fire')
  })

  it('normalize：非法输入报错、合法输入归一', () => {
    expect(normalizeTriggerCondition({ type: 'once', at: 'not-a-date' })).toEqual({ error: expect.any(String) })
    expect(normalizeTriggerCondition({ type: 'interval', everyMinutes: 0 })).toEqual({ error: expect.any(String) })
    expect(validateTriggerCondition({ type: 'cron', expression: 'not-a-cron' })).toMatch(/invalid cron/)
    const ok = normalizeTriggerCondition({ type: 'interval', everyMinutes: 30 })
    expect('error' in ok).toBe(false)
    expect(validateTriggerCondition({ type: 'cron', expression: '0 9 * * *' })).toBeNull()
  })

  it('initialTriggerState：enabled=false → paused；once 过期 → completed', () => {
    expect(initialTriggerState(task({ enabled: false }), BASE).status).toBe('paused')
    expect(initialTriggerState(task({ condition: { type: 'once', at: new Date(BASE - 1000).toISOString() } }), BASE).status).toBe('completed')
    expect(initialTriggerState(task(), BASE).nextRunAt).toBe(BASE + 30 * 60_000)
  })
})

describe('TriggerManager（收割与 CRUD）', () => {
  function makeManager(options: { fire?: (req: { task: TriggerTask }) => void, admin?: boolean } = {}) {
    let now = BASE
    const fired: TriggerTask[] = []
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: ['vip'], maxTasksPerOwner: 2 }),
      fire: ({ task: firedTask }) => {
        fired.push(firedTask)
        options.fire?.({ task: firedTask })
      },
      checkAdmin: async () => options.admin ?? false,
      now: () => now,
    })
    return { manager, fired, advance: (ms: number) => { now += ms } }
  }

  it('create → 到期收割 → afterRun 重排 → 再到期再跑', async () => {
    const { manager, fired, advance } = makeManager()
    const created = await manager.create({
      name: '每分钟任务',
      habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 },
      prompt: 'p',
      ownerKey: 'onebot:bot1:admin',
    })
    expect('error' in created).toBe(false)
    const createdTask = created as TriggerTask
    expect(createdTask.state.nextRunAt).toBeGreaterThan(BASE - 1)

    advance(61_000)
    await manager['harvest']()
    expect(fired.map((task) => task.id)).toEqual([createdTask.id])
    // 运行后重排
    const reloaded = await manager.get(createdTask.id)
    expect(reloaded!.state.runCount).toBe(1)
    expect(reloaded!.state.status).toBe('waiting')

    advance(60_000)
    await manager['harvest']()
    expect(fired).toHaveLength(2)
  })

  it('广播任务（habitatId=*）到期对每个活跃窗口各点火一次；无活跃窗口跳过', async () => {
    const firedHabitats: string[] = []
    let activeHabitats: string[] = []
    let now = BASE
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: ['vip'], maxTasksPerOwner: 20 }),
      fire: ({ habitatId, lifeId }) => { if (habitatId) firedHabitats.push(`${lifeId ?? ''}:${habitatId}`) },
      listHabitats: () => activeHabitats.map((habitatId) => ({ lifeId: 'life-r', habitatId })),
      checkAdmin: async () => true,
      now: () => now,
    })
    const created = (await manager.create({
      name: '全群早报', habitatId: '*',
      condition: { type: 'interval', everyMinutes: 1 }, prompt: '早安',
      ownerKey: 'onebot:bot1:admin',
    })) as TriggerTask

    now += 61_000
    await manager['harvest']()
    expect(firedHabitats).toEqual([])  // 无活跃窗口：跳过并记 lastError
    const skipped = await manager.get(created.id)
    expect(skipped!.state.lastError).toContain('no active habitats')
    expect(skipped!.state.status).toBe('waiting')  // 排程照常推进

    activeHabitats = ['g1', 'g2', 'dm-user1']
    now += 60_000
    await manager['harvest']()
    // 展开携带真实 lifeId（防多 life 放大守卫的空串哨兵）
    expect(firedHabitats.sort()).toEqual(['life-r:dm-user1', 'life-r:g1', 'life-r:g2'])
  })

  it('owner 配额限制', async () => {
    const { manager } = makeManager()
    for (let i = 0; i < 2; i++) {
      const result = await manager.create({
        name: `t${i}`, habitatId: 'g1',
        condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p',
        ownerKey: 'onebot:bot1:admin',
      })
      expect('error' in result).toBe(false)
    }
    const third = await manager.create({
      name: 't3', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p',
      ownerKey: 'onebot:bot1:admin',
    })
    expect(third).toEqual({ error: expect.stringContaining('quota') })
  })

  it('update 改定义重排程；pause_until/resume', async () => {
    const { manager, advance } = makeManager()
    const created = (await manager.create({
      name: 't', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 30 }, prompt: 'p',
      ownerKey: 'u',
    })) as TriggerTask

    const updated = await manager.update(created.id, { condition: { type: 'interval', everyMinutes: 10 } })
    expect((updated as TriggerTask).state.nextRunAt).toBe(BASE + 10 * 60_000)

    advance(1)
    const paused = await manager.pauseUntil(created.id, BASE + 999_999)
    expect((paused as TriggerTask).state.status).toBe('paused')

    const resumed = await manager.resume(created.id)
    expect((resumed as TriggerTask).state.status).toBe('waiting')
  })

  it('update/重新 enable/resume 重排保留 runCount/lastRunAt 历史', async () => {
    const { manager, advance } = makeManager()
    const created = (await manager.create({
      name: 't', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 1 }, prompt: 'p',
      ownerKey: 'u',
    })) as TriggerTask

    // 跑两次积累历史
    advance(61_000)
    await manager['harvest']()
    advance(60_000)
    await manager['harvest']()
    const ran = await manager.get(created.id)
    expect(ran!.state.runCount).toBe(2)
    expect(ran!.state.lastRunAt).not.toBeNull()

    // disable → enable 重排不清零
    await manager.update(created.id, { enabled: false })
    const reenabled = (await manager.update(created.id, { enabled: true })) as TriggerTask
    expect(reenabled.state.runCount).toBe(2)
    expect(reenabled.state.lastRunAt).toBe(ran!.state.lastRunAt)

    // resume 同样保留
    await manager.pauseUntil(created.id, BASE + 10_000_000)
    const resumed = (await manager.resume(created.id)) as TriggerTask
    expect(resumed.state.runCount).toBe(2)
    expect(resumed.state.lastRunAt).toBe(ran!.state.lastRunAt)
  })

  it('manual fire：广播任务展开到全部活跃窗口；无活跃窗口报错', async () => {
    const firedHabitats: string[] = []
    let activeHabitats: Array<{ lifeId: string, habitatId: string }> = []
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: ['vip'], maxTasksPerOwner: 20 }),
      fire: ({ habitatId, lifeId, source, task }) => {
        firedHabitats.push(`${source}:${lifeId ?? ''}:${habitatId ?? task.habitatId}`)
      },
      listHabitats: () => activeHabitats,
      checkAdmin: async () => true,
      now: () => BASE,
    })
    const broadcast = (await manager.create({
      name: '广播', habitatId: '*',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p',
      ownerKey: 'u',
    })) as TriggerTask
    const single = (await manager.create({
      name: '单群', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p',
      ownerKey: 'u',
    })) as TriggerTask

    // 无活跃窗口：广播试跑报错；单群任务不受影响
    const noTargets = await manager.fire(broadcast.id)
    expect(noTargets).toEqual({ error: 'no active habitats' })
    expect(firedHabitats).toEqual([])

    await manager.fire(single.id)
    expect(firedHabitats).toEqual([`manual::g1`])

    // 有活跃窗口：广播逐窗口点火（manual 语义，不改变排程）
    activeHabitats = [{ lifeId: 'life-a', habitatId: 'g1' }, { lifeId: 'life-a', habitatId: 'g2' }]
    const firedBroadcast = await manager.fire(broadcast.id)
    expect('error' in firedBroadcast).toBe(false)
    expect(firedHabitats.slice(1).sort()).toEqual(['manual:life-a:g1', 'manual:life-a:g2'])
    const reloaded = await manager.get(broadcast.id)
    expect(reloaded!.state.runCount).toBe(0)  // 试跑不计入排程历史
  })
})

describe('trigger 工具（LLM 自管理）', () => {
  function makeTool(options: { admin?: boolean, actorUserId?: string } = {}) {
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: ['vip'], maxTasksPerOwner: 20 }),
      fire: vi.fn(),
      checkAdmin: async () => options.admin ?? false,
      now: () => BASE,
    })
    const entry = createTriggerToolEntry({
      manager,
      habitatId: 'g1',
      actor: { userId: options.actorUserId ?? 'user-1', platform: 'onebot', botId: 'bot1' },
    })
    return { manager, entry }
  }

  it('非管理员写操作被拒（trigger-forbidden）；读操作放行', async () => {
    const { entry } = makeTool({ admin: false })
    const denied = await entry.execute({ action: 'create', task: { name: 'x', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p' } })
    expect(denied).toMatchObject({ ok: false, code: 'trigger-forbidden' })

    const listed = await entry.execute({ action: 'list' })
    expect(Array.isArray(listed)).toBe(true)
  })

  it('白名单管理员可创建/查询/启停/删除', async () => {
    const { entry } = makeTool({ admin: false, actorUserId: 'vip' })
    const created = await entry.execute({
      action: 'create',
      task: { name: '晨间问候', condition: { type: 'cron', expression: '0 9 * * *' }, prompt: '早安问候' },
    }) as TriggerTask
    expect(created.id).toMatch(/^trigger-/)
    expect(created.habitatId).toBe('g1')  // 目标锁定当前会话

    const got = await entry.execute({ action: 'get', id: created.id }) as TriggerTask
    expect(got.name).toBe('晨间问候')

    const disabled = await entry.execute({ action: 'disable', id: created.id }) as TriggerTask
    expect(disabled.enabled).toBe(false)

    const removed = await entry.execute({ action: 'remove', id: created.id })
    expect(removed).toMatchObject({ ok: true, removed: created.id })
  })

  it('缺 id / 非法条件返回结构化错误（模型可自纠）', async () => {
    const { entry } = makeTool({ admin: true })
    const noId = await entry.execute({ action: 'get' })
    expect(noId).toMatchObject({ ok: false, code: 'trigger-invalid-input' })

    const bad = await entry.execute({
      action: 'create',
      task: { name: 'x', condition: { type: 'once', at: '不合法' }, prompt: 'p' },
    })
    expect(bad).toMatchObject({ ok: false, code: 'trigger-invalid-input', message: expect.any(String) })
  })

  it('readOnly（定时/批量唤醒）：写操作拒绝 read-only during scheduled wake；list/get 放行', async () => {
    const manager = new TriggerManager({
      store: new MemoryTriggerTaskRepository(),
      config: () => ({ enabled: true, adminWhitelist: ['vip'], maxTasksPerOwner: 20 }),
      fire: vi.fn(),
      checkAdmin: async () => true,
      now: () => BASE,
    })
    const created = (await manager.create({
      name: 't', habitatId: 'g1',
      condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p',
      ownerKey: 'u',
    })) as TriggerTask
    const entry = createTriggerToolEntry({
      manager,
      habitatId: 'g1',
      readOnly: true,
      actor: { userId: 'vip', platform: 'onebot', botId: 'bot1' },
    })

    // 管理员身份也不放行写操作（actor 归因错配防护）
    for (const args of [
      { action: 'create', task: { name: 'x', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p' } },
      { action: 'update', id: created.id, task: { name: 'x', condition: { type: 'interval', everyMinutes: 10 }, prompt: 'p' } },
      { action: 'disable', id: created.id },
      { action: 'enable', id: created.id },
      { action: 'fire', id: created.id },
      { action: 'remove', id: created.id },
    ]) {
      expect(await entry.execute(args)).toMatchObject({ ok: false, code: 'trigger-forbidden', message: 'read-only during scheduled wake' })
    }

    // 读操作不受影响
    expect(Array.isArray(await entry.execute({ action: 'list' }))).toBe(true)
    expect(await entry.execute({ action: 'get', id: created.id })).toMatchObject({ id: created.id })
  })
})
