/**
 * Phase 18 Scheduler 最小闭环集成测试
 *
 * 验证 Scheduler 作为数字生命“未来行为调度层”的最小能力：
 * 1. 可创建并查询 scheduled task
 * 2. tick() 只执行 due task
 * 3. completed task 不会重复执行
 * 4. failed task 会记录 attempts 与 lastError
 * 5. cancelled task 不会执行
 * 6. follow-up task 可通过 payload.stimulus 重新注入 stimulus.received
 */

import { afterEach, describe, expect, it } from 'vitest'
import type {
  CoreEventMap,
  ScheduledTask,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createDefaultRuntime, type Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import {
  DefaultSchedulerService,
  MemoryScheduledTaskRepository,
} from '../packages/elysia-ai-runtime/src/scheduler/index.js'

function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'system',
    timestamp: Date.now(),
    habitatId: 'habitat-phase18',
    actorId: 'scheduler-phase18',
    channelId: 'channel-phase18',
    platform: 'qq',
    botId: 'bot-phase18',
    payload: {
      content: 'follow-up stimulus',
    },
  }
}

describe('Phase 18 Scheduler 最小闭环集成测试', () => {
  let runtime: Runtime | undefined

  afterEach(async () => {
    if (runtime?.getState() === 'running') await runtime.stop()
    runtime = undefined
  })

  it('可创建并查询 scheduled task', async () => {
    runtime = createDefaultRuntime()

    const createdEvents: CoreEventMap['scheduler.task.created'][] = []
    runtime.context.eventBus.on('scheduler.task.created', (payload) => {
      createdEvents.push(payload)
    })

    const task = await runtime.scheduler.schedule({
      id: 'task-phase18-create',
      type: 'followup',
      runAt: 1000,
      target: {
        lifeId: 'life-phase18',
        habitatId: 'habitat-phase18',
      },
      priority: 10,
      payload: {
        reason: 'unit-test',
      },
    })

    expect(task.id).toBe('task-phase18-create')
    expect(task.status).toBe('pending')
    expect(task.priority).toBe(10)

    await expect(runtime.scheduledTaskRepository.getById('task-phase18-create')).resolves.toEqual(task)
    await expect(runtime.scheduler.listTasks()).resolves.toEqual([task])
    expect(createdEvents).toEqual([{ taskId: 'task-phase18-create', task }])
  })

  it('tick() 只执行 due task，且按 priority 从高到低执行', async () => {
    const repository = new MemoryScheduledTaskRepository()
    const executedTaskIds: string[] = []
    runtime = createDefaultRuntime({
      scheduledTaskRepository: repository,
    })

    runtime.scheduler = new DefaultSchedulerService(
      repository,
      runtime.context.eventBus,
      {
        followup: async (task) => {
          executedTaskIds.push(task.id)
        },
      },
      runtime.context.logger,
    )

    await runtime.scheduler.schedule({
      id: 'task-phase18-future',
      type: 'followup',
      runAt: 2000,
    })
    await runtime.scheduler.schedule({
      id: 'task-phase18-low',
      type: 'followup',
      runAt: 1000,
      priority: 1,
    })
    await runtime.scheduler.schedule({
      id: 'task-phase18-high',
      type: 'followup',
      runAt: 1000,
      priority: 100,
    })

    const results = await runtime.scheduler.tick(1000)

    expect(results).toHaveLength(2)
    expect(executedTaskIds).toEqual(['task-phase18-high', 'task-phase18-low'])

    expect((await repository.getById('task-phase18-high'))?.status).toBe('completed')
    expect((await repository.getById('task-phase18-low'))?.status).toBe('completed')
    expect((await repository.getById('task-phase18-future'))?.status).toBe('pending')
  })

  it('completed task 不会重复执行', async () => {
    const repository = new MemoryScheduledTaskRepository()
    let executedCount = 0
    runtime = createDefaultRuntime({
      scheduledTaskRepository: repository,
    })

    runtime.scheduler = new DefaultSchedulerService(
      repository,
      runtime.context.eventBus,
      {
        followup: async () => {
          executedCount += 1
        },
      },
      runtime.context.logger,
    )

    await runtime.scheduler.schedule({
      id: 'task-phase18-once',
      type: 'followup',
      runAt: 1000,
    })

    await runtime.scheduler.tick(1000)
    await runtime.scheduler.tick(1000)

    expect(executedCount).toBe(1)
    expect((await repository.getById('task-phase18-once'))?.status).toBe('completed')
  })

  it('failed task 会记录 attempts 与 lastError', async () => {
    const repository = new MemoryScheduledTaskRepository()
    runtime = createDefaultRuntime({
      scheduledTaskRepository: repository,
    })

    runtime.scheduler = new DefaultSchedulerService(
      repository,
      runtime.context.eventBus,
      {
        followup: async () => {
          throw new Error('phase18 failure')
        },
      },
      runtime.context.logger,
    )

    const failedEvents: CoreEventMap['scheduler.task.failed'][] = []
    runtime.context.eventBus.on('scheduler.task.failed', (payload) => {
      failedEvents.push(payload)
    })

    await runtime.scheduler.schedule({
      id: 'task-phase18-failed',
      type: 'followup',
      runAt: 1000,
      maxAttempts: 1,
    })

    const results = await runtime.scheduler.tick(1000)
    const failed = await repository.getById('task-phase18-failed')

    expect(results).toHaveLength(1)
    expect(results[0].completed).toBe(false)
    expect(failed?.status).toBe('failed')
    expect(failed?.attempts).toBe(1)
    expect(failed?.lastError).toBe('phase18 failure')
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].taskId).toBe('task-phase18-failed')
  })

  it('cancelled task 不会执行', async () => {
    const repository = new MemoryScheduledTaskRepository()
    let executed = false
    runtime = createDefaultRuntime({
      scheduledTaskRepository: repository,
    })

    runtime.scheduler = new DefaultSchedulerService(
      repository,
      runtime.context.eventBus,
      {
        followup: async () => {
          executed = true
        },
      },
      runtime.context.logger,
    )

    await runtime.scheduler.schedule({
      id: 'task-phase18-cancelled',
      type: 'followup',
      runAt: 1000,
    })
    await runtime.scheduler.cancel('task-phase18-cancelled', 'test cancellation')

    const results = await runtime.scheduler.tick(1000)
    const cancelled = await repository.getById('task-phase18-cancelled')

    expect(results).toEqual([])
    expect(executed).toBe(false)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.metadata?.['cancelReason']).toBe('test cancellation')
  })

  it('follow-up task 可通过 payload.stimulus 重新注入 stimulus.received', async () => {
    runtime = createDefaultRuntime()

    const stimulusEvents: CoreEventMap['stimulus.received'][] = []
    runtime.context.eventBus.on('stimulus.received', (payload) => {
      stimulusEvents.push(payload)
    })

    const stimulus = createStimulus('stim-phase18-followup')
    await runtime.scheduler.schedule({
      id: 'task-phase18-followup',
      type: 'followup',
      runAt: 1000,
      payload: {
        stimulus,
      },
    })

    await runtime.scheduler.tick(1000)

    expect(stimulusEvents).toEqual([{
      stimulusId: 'stim-phase18-followup',
      stimulus,
    }])
    expect((await runtime.scheduledTaskRepository.getById('task-phase18-followup'))?.status).toBe('completed')
  })

  it('expired task 会标记为 expired 且不执行 handler', async () => {
    const repository = new MemoryScheduledTaskRepository()
    let executed = false
    runtime = createDefaultRuntime({
      scheduledTaskRepository: repository,
    })

    runtime.scheduler = new DefaultSchedulerService(
      repository,
      runtime.context.eventBus,
      {
        followup: async () => {
          executed = true
        },
      },
      runtime.context.logger,
    )

    const expiredEvents: CoreEventMap['scheduler.task.expired'][] = []
    runtime.context.eventBus.on('scheduler.task.expired', (payload) => {
      expiredEvents.push(payload)
    })

    await runtime.scheduler.schedule({
      id: 'task-phase18-expired',
      type: 'followup',
      runAt: 1000,
      expiresAt: 999,
    })

    const results = await runtime.scheduler.tick(1000)
    const expired = await repository.getById('task-phase18-expired') as ScheduledTask

    expect(results).toHaveLength(1)
    expect(results[0].completed).toBe(false)
    expect(executed).toBe(false)
    expect(expired.status).toBe('expired')
    expect(expiredEvents).toEqual([{
      taskId: 'task-phase18-expired',
      task: expired,
    }])
  })
})
