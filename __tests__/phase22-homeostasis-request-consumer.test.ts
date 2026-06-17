import { describe, expect, it, vi } from 'vitest'
import type {
  CoreEventMap,
  HomeostasisState,
  ResponsePlan,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createBehaviorExecutionPlan } from '../packages/@elysia-ai/behavior/src/execution-plan.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { MemoryStateRepository } from '../packages/elysia-ai-runtime/src/store/memory-state-repository.js'

function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: 1000,
    habitatId: 'habitat-phase22',
    actorId: 'actor-phase22',
    threadId: 'thread-phase22',
    channelId: 'channel-phase22',
    platform: 'qq',
    botId: 'bot-phase22',
    payload: {
      content: 'phase22 homeostasis interaction',
    },
  }
}

function createPlan(): ResponsePlan {
  return {
    scope: {
      type: 'user',
      key: 'actor-phase22',
    },
    sourceStimulusIds: ['stim-phase22'],
    mode: 'internal-update-only',
    plannerSource: 'program',
    shouldEnterDialogue: false,
    shouldUpdateMemory: false,
    shouldUpdateBond: false,
    shouldUpdateHomeostasis: true,
    shouldScheduleFollowup: false,
    reason: 'phase22 homeostasis request consumer test',
  }
}

describe('Phase 22 Homeostasis Request Consumer 一体化测试', () => {
  it('BehaviorExecution homeostasis-update action 会经 HomeostasisService 写入 LifeStateRepository 并发出 homeostasis.updated', async () => {
    const runtime = createDefaultRuntime()
    const observatory = new DefaultObservatoryService(100)
    const updatedEvents: CoreEventMap['homeostasis.updated'][] = []

    ;(runtime.context.eventBus as any).on('homeostasis.updated', (payload: CoreEventMap['homeostasis.updated']) => {
      updatedEvents.push(payload)
      observatory.recordEvent('homeostasis.updated', payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase22')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase22',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(updatedEvents).toHaveLength(1)

    const event = updatedEvents[0]
    expect(event.lifeInstanceId).toBe('life-phase22')
    expect(event.requestId).toMatch(/^homeostasis-update-1000-/)
    expect(event.planId).toBe(plan.id)
    expect(event.actionId).toBe(plan.actions.find((action) => action.type === 'homeostasis-update')?.id)
    expect(event.state.lifeInstanceId).toBe('life-phase22')
    expect(event.state.energy).toBeLessThan(0.8)
    expect(event.delta.reason).toBe('phase22 homeostasis request consumer test')
    expect(event.result?.updated).toBe(true)

    const stored = await runtime.stateRepository.getByLifeInstanceId('life-phase22')
    expect(stored?.lifeInstanceId).toBe('life-phase22')
    expect(stored?.metadata?.lastHomeostasisUpdateRequestId).toBe(event.requestId)

    const trace = observatory.getRecentEvents()
    expect(trace[0]).toMatchObject({
      kind: 'homeostasis',
      event: 'homeostasis.updated',
      homeostasisRequestId: event.requestId,
      lifeId: 'life-phase22',
      stimulusId: 'stim-phase22',
      executionPlanId: plan.id,
    })

    await runtime.stop()
  })

  it('HomeostasisService 会合并已有 state 并保留 metadata', async () => {
    const stateRepository = new MemoryStateRepository<HomeostasisState>()
    await stateRepository.save('life-phase22-merge', {
      lifeInstanceId: 'life-phase22-merge',
      timestamp: 500,
      energy: 0.6,
      mood: 0.1,
      sociability: 0.4,
      curiosity: 0.5,
      responseThreshold: 0.3,
      metadata: {
        existing: true,
      },
    })

    const runtime = createDefaultRuntime({
      stateRepository,
    })

    await runtime.start()

    const result = await runtime.homeostasisService.update({
      id: 'homeostasis-request-merge',
      lifeId: 'life-phase22-merge',
      stimulusId: 'stim-phase22-merge',
      reason: 'merge existing state',
      delta: {
        energy: 0.1,
        mood: -0.2,
        sociability: 0.2,
      },
      createdAt: 1000,
      metadata: {
        requestMeta: true,
      },
    })

    expect(result.state.energy).toBeCloseTo(0.7)
    expect(result.state.mood).toBeCloseTo(-0.1)
    expect(result.state.sociability).toBeCloseTo(0.6)
    expect(result.state.curiosity).toBeCloseTo(0.5)
    expect(result.state.responseThreshold).toBeCloseTo(0.3)
    expect(result.state.metadata).toMatchObject({
      existing: true,
      requestMeta: true,
      lastHomeostasisUpdateRequestId: 'homeostasis-request-merge',
    })

    await runtime.stop()
  })

  it('HomeostasisService 会 clamp energy/sociability/curiosity/responseThreshold 到 0..1 且 mood 到 -1..1', async () => {
    const runtime = createDefaultRuntime()

    await runtime.start()

    const high = await runtime.homeostasisService.update({
      id: 'homeostasis-request-clamp-high',
      lifeId: 'life-phase22-clamp',
      reason: 'clamp high',
      delta: {
        energy: 10,
        mood: 10,
        sociability: 10,
        curiosity: 10,
        responseThreshold: 10,
      },
      createdAt: 1000,
    })

    expect(high.state.energy).toBe(1)
    expect(high.state.mood).toBe(1)
    expect(high.state.sociability).toBe(1)
    expect(high.state.curiosity).toBe(1)
    expect(high.state.responseThreshold).toBe(1)

    const low = await runtime.homeostasisService.update({
      id: 'homeostasis-request-clamp-low',
      lifeId: 'life-phase22-clamp',
      reason: 'clamp low',
      delta: {
        energy: -10,
        mood: -10,
        sociability: -10,
        curiosity: -10,
        responseThreshold: -10,
      },
      createdAt: 2000,
    })

    expect(low.state.energy).toBe(0)
    expect(low.state.mood).toBe(-1)
    expect(low.state.sociability).toBe(0)
    expect(low.state.curiosity).toBe(0)
    expect(low.state.responseThreshold).toBe(0)

    await runtime.stop()
  })

  it('HomeostasisService 写入失败时发出 homeostasis.update.failed 且不破坏 execution result', async () => {
    const stateRepository = new MemoryStateRepository<HomeostasisState>()
    const runtime = createDefaultRuntime({
      stateRepository,
    })
    const failedEvents: CoreEventMap['homeostasis.update.failed'][] = []
    const saveSpy = vi.spyOn(stateRepository, 'save').mockRejectedValueOnce(new Error('phase22 homeostasis save failure'))

    ;(runtime.context.eventBus as any).on('homeostasis.update.failed', (payload: CoreEventMap['homeostasis.update.failed']) => {
      failedEvents.push(payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase22-failure')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase22-failure',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].request.lifeId).toBe('life-phase22-failure')
    expect(failedEvents[0].planId).toBe(plan.id)

    saveSpy.mockRestore()
    await runtime.stop()
  })

  it('Observatory 能记录 homeostasis.update.failed trace', async () => {
    const observatory = new DefaultObservatoryService(100)

    const record = observatory.recordEvent('homeostasis.update.failed', {
      requestId: 'homeostasis-request-observatory-failed',
      request: {
        id: 'homeostasis-request-observatory-failed',
        lifeId: 'life-phase22-observatory',
        stimulusId: 'stim-phase22-observatory',
        reason: 'observatory failure test',
        createdAt: 1000,
      },
      error: new Error('observatory failure'),
      planId: 'plan-phase22-observatory',
      actionId: 'action-phase22-observatory',
    })

    expect(record).toMatchObject({
      kind: 'homeostasis',
      event: 'homeostasis.update.failed',
      status: 'failed',
      homeostasisRequestId: 'homeostasis-request-observatory-failed',
      lifeId: 'life-phase22-observatory',
      stimulusId: 'stim-phase22-observatory',
      executionPlanId: 'plan-phase22-observatory',
      executionActionId: 'action-phase22-observatory',
    })
  })
})
