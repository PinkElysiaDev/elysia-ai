import { describe, expect, it } from 'vitest'
import type {
  CoreEventMap,
  ResponsePlan,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createBehaviorExecutionPlan } from '../packages/@elysia-ai/behavior/src/execution-plan.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'

function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: 1000,
    habitatId: 'habitat-phase19',
    actorId: 'actor-phase19',
    channelId: 'channel-phase19',
    platform: 'qq',
    botId: 'bot-phase19',
    payload: {
      content: 'phase19 hello',
    },
  }
}

function createPlan(): ResponsePlan {
  return {
    scope: {
      type: 'user',
      key: 'actor-phase19',
    },
    sourceStimulusIds: ['stim-phase19'],
    mode: 'send-to-ai',
    plannerSource: 'program',
    shouldEnterDialogue: true,
    shouldUpdateMemory: true,
    shouldUpdateBond: true,
    shouldUpdateHomeostasis: true,
    shouldScheduleFollowup: true,
    reason: 'phase19 execution test',
  }
}

describe('Phase 19-22 Execution Layer 一体化测试', () => {
  it('BehaviorExecutionPlan 会把 ResponsePlan flags 展开为完整 actions', () => {
    const stimulus = createStimulus('stim-phase19')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase19',
      plan: createPlan(),
      now: 1000,
    })

    // schedule-followup action 已随 SchedulerService 退役移除：
    // followup 死链（无生产者语义重叠）由 TriggerManager 统一定时唤醒。
    expect(plan.actions.map((action: { type: string }) => action.type)).toEqual([
      'dialogue',
      'memory-update',
      'bond-update',
      'homeostasis-update',
    ])
    expect(plan.status).toBe('pending')
    expect(plan.lifeId).toBe('life-phase19')
    expect(plan.stimulusId).toBe('stim-phase19')
  })

  it('Runtime execution service 会执行 dialogue/memory/bond/homeostasis actions 并形成事件链', async () => {
    const runtime = createDefaultRuntime()
    const stimulus = createStimulus('stim-phase19')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase19',
      plan: createPlan(),
      now: 1000,
    })

    const events: string[] = []
    const memoryEvents: CoreEventMap['behavior.memory.update.requested'][] = []
    const bondEvents: CoreEventMap['behavior.bond.update.requested'][] = []
    const homeostasisEvents: CoreEventMap['behavior.homeostasis.update.requested'][] = []

    const eventBus = runtime.context.eventBus as any
    eventBus.on('behavior.execution.started', () => events.push('behavior.execution.started'))
    eventBus.on('behavior.execution.action.started', () => events.push('behavior.execution.action.started'))
    eventBus.on('behavior.execution.action.completed', () => events.push('behavior.execution.action.completed'))
    eventBus.on('behavior.execution.completed', () => events.push('behavior.execution.completed'))
    eventBus.on('behavior.memory.update.requested', (payload: CoreEventMap['behavior.memory.update.requested']) => memoryEvents.push(payload))
    eventBus.on('behavior.bond.update.requested', (payload: CoreEventMap['behavior.bond.update.requested']) => bondEvents.push(payload))
    eventBus.on('behavior.homeostasis.update.requested', (payload: CoreEventMap['behavior.homeostasis.update.requested']) => homeostasisEvents.push(payload))

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(result.actionResults).toHaveLength(4)
    expect(events).toContain('behavior.execution.started')
    expect(events).toContain('behavior.execution.completed')
    expect(memoryEvents).toHaveLength(1)
    expect(bondEvents).toHaveLength(1)
    expect(homeostasisEvents).toHaveLength(1)
  })
})
