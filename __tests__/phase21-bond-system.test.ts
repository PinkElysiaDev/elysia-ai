import { describe, expect, it, vi } from 'vitest'
import { Context } from 'koishi'
import type {
  Bond,
  CoreEventMap,
  ResponsePlan,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createBehaviorExecutionPlan } from '../packages/@elysia-ai/behavior/src/execution-plan.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { apply as applyBondPlugin } from '../packages/elysia-ai-bond/src/index.js'
import { MemoryBondRepository } from '../packages/@elysia-ai/bond/src/index.js'


function installBondPlugin(runtime: ReturnType<typeof createDefaultRuntime>) {
  const ctx = new Context() as any
  ctx['elysia-ai-runtime'] = runtime
  applyBondPlugin(ctx, { enabled: true, contextLimit: 5 })
  return ctx['elysia.bond']
}
function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: 1000,
    habitatId: 'habitat-phase21',
    actorId: 'actor-phase21',
    threadId: 'thread-phase21',
    channelId: 'channel-phase21',
    platform: 'qq',
    botId: 'bot-phase21',
    payload: {
      content: 'phase21 bond interaction',
    },
  }
}

function createPlan(): ResponsePlan {
  return {
    scope: {
      type: 'user',
      key: 'actor-phase21',
    },
    sourceStimulusIds: ['stim-phase21'],
    mode: 'internal-update-only',
    plannerSource: 'program',
    shouldEnterDialogue: false,
    shouldUpdateMemory: false,
    shouldUpdateBond: true,
    shouldUpdateHomeostasis: false,
    shouldScheduleFollowup: false,
    reason: 'phase21 bond system test',
  }
}

describe('Phase 21 Bond System v1 涓€浣撳寲娴嬭瘯', () => {
  it('BehaviorExecution bond-update action 浼氱粡 BondService 鍐欏叆姝ｅ紡 Bond 骞跺彂鍑?bond.created', async () => {
    const runtime = createDefaultRuntime()
    installBondPlugin(runtime)
    const observatory = new DefaultObservatoryService(100)
    const createdEvents: CoreEventMap['bond.created'][] = []

    ;(runtime.context.eventBus as any).on('bond.created', (payload: CoreEventMap['bond.created']) => {
      createdEvents.push(payload)
      observatory.recordEvent('bond.created', payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase21')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase21',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(createdEvents).toHaveLength(1)

    const bond = createdEvents[0].bond
    expect(bond.lifeId).toBe('life-phase21')
    expect(bond.lifeInstanceId).toBe('life-phase21')
    expect(bond.targetId).toBe('actor-phase21')
    expect(bond.targetType).toBe('actor')
    expect(bond.status).toBe('active')
    expect(bond.actorId).toBe('actor-phase21')
    expect(bond.habitatId).toBe('habitat-phase21')
    expect(bond.threadId).toBe('thread-phase21')
    expect(bond.metrics.familiarity).toBeGreaterThan(0.1)
    expect(bond.metrics.trust).toBeGreaterThan(0.1)
    expect(bond.interactionCount).toBe(1)
    expect(bond.source?.stimulusId).toBe('stim-phase21')
    expect(bond.source?.executionPlanId).toBe(plan.id)

    const stored = await runtime.bondRepository.getByLifeAndTarget('life-phase21', 'actor-phase21')
    expect(stored?.id).toBe(bond.id)

    const trace = observatory.getRecentEvents()
    expect(trace[0]).toMatchObject({
      kind: 'bond',
      event: 'bond.created',
      bondId: bond.id,
      bondRequestId: createdEvents[0].requestId,
      bondTargetId: 'actor-phase21',
      bondTargetType: 'actor',
      lifeId: 'life-phase21',
    })

    await runtime.stop()
  })

  it('BondService 浼氭寜 life/target 鍚堝苟閲嶅鏇存柊骞剁疮璁?metrics', async () => {
    const runtime = createDefaultRuntime()
    installBondPlugin(runtime)
    const updatedEvents: CoreEventMap['bond.updated'][] = []

    ;(runtime.context.eventBus as any).on('bond.updated', (payload: CoreEventMap['bond.updated']) => {
      updatedEvents.push(payload)
    })

    await runtime.start()

    const first = await runtime.bondService.update({
      id: 'bond-request-merge-1',
      lifeId: 'life-phase21-merge',
      targetId: 'actor-merge',
      targetType: 'actor',
      actorId: 'actor-merge',
      sentiment: 'positive',
      delta: {
        familiarity: 0.2,
        trust: 0.1,
      },
      tags: ['first'],
      createdAt: 1000,
      source: {
        stimulusId: 'stim-bond-merge-1',
      },
    })

    const second = await runtime.bondService.update({
      id: 'bond-request-merge-2',
      lifeId: 'life-phase21-merge',
      targetId: 'actor-merge',
      targetType: 'actor',
      actorId: 'actor-merge',
      sentiment: 'positive',
      delta: {
        familiarity: 0.2,
        intimacy: 0.1,
      },
      tags: ['second'],
      createdAt: 2000,
      source: {
        stimulusId: 'stim-bond-merge-2',
      },
    })

    expect(second.created).toBe(false)
    expect(second.updated).toBe(true)
    expect(second.bond.id).toBe(first.bond.id)
    expect(second.bond.metrics.familiarity).toBeGreaterThan(first.bond.metrics.familiarity)
    expect(second.bond.metrics.intimacy).toBeGreaterThan(first.bond.metrics.intimacy)
    expect(second.bond.tags).toEqual(['first', 'second'])
    expect(second.bond.interactionCount).toBe(2)

    const stored = await runtime.bondRepository.listByLife('life-phase21-merge')
    expect(stored).toHaveLength(1)

    await runtime.stop()
  })

  it('BondService 鏀寔鎸?life/target/status/tag/metric 鏌ヨ骞跺彂鍑?bond.retrieved', async () => {
    const runtime = createDefaultRuntime()
    installBondPlugin(runtime)
    const retrievedEvents: CoreEventMap['bond.retrieved'][] = []

    ;(runtime.context.eventBus as any).on('bond.retrieved', (payload: CoreEventMap['bond.retrieved']) => {
      retrievedEvents.push(payload)
    })

    await runtime.start()

    await runtime.bondService.update({
      id: 'bond-request-query-1',
      lifeId: 'life-phase21-query',
      targetId: 'actor-a',
      targetType: 'actor',
      actorId: 'actor-a',
      delta: {
        familiarity: 0.5,
        trust: 0.4,
      },
      tags: ['friend'],
      createdAt: 1000,
    })

    await runtime.bondService.update({
      id: 'bond-request-query-2',
      lifeId: 'life-phase21-query',
      targetId: 'actor-b',
      targetType: 'actor',
      actorId: 'actor-b',
      delta: {
        familiarity: 0.05,
        tension: 0.4,
      },
      tags: ['conflict'],
      createdAt: 2000,
    })

    const result = await runtime.bondService.retrieve({
      lifeId: 'life-phase21-query',
      targetId: 'actor-a',
      targetType: 'actor',
      status: 'active',
      tags: ['friend'],
      minFamiliarity: 0.5,
      minTrust: 0.4,
      limit: 10,
    })

    expect(result.total).toBe(1)
    expect(result.bonds[0]).toMatchObject({
      lifeId: 'life-phase21-query',
      targetId: 'actor-a',
      targetType: 'actor',
      status: 'active',
    })
    expect(retrievedEvents).toHaveLength(1)
    expect(retrievedEvents[0].result.bonds).toHaveLength(1)

    await runtime.stop()
  })

  it('BondService 鍐欏叆澶辫触鏃跺彂鍑?bond.update.failed 涓斾笉鐮村潖 execution result', async () => {
    const runtime = createDefaultRuntime()
    installBondPlugin(runtime)
    const failedEvents: CoreEventMap['bond.update.failed'][] = []
    const repository = runtime.bondRepository as MemoryBondRepository
    const saveSpy = vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('phase21 bond save failure'))

    ;(runtime.context.eventBus as any).on('bond.update.failed', (payload: CoreEventMap['bond.update.failed']) => {
      failedEvents.push(payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase21-failure')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase21-failure',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].request.lifeId).toBe('life-phase21-failure')

    saveSpy.mockRestore()
    await runtime.stop()
  })

  it('BondService 鏀寔鎵嬪姩鍐欏叆 habitat/thread/life 鐩爣绫诲瀷', async () => {
    const runtime = createDefaultRuntime()
    installBondPlugin(runtime)

    await runtime.start()

    const habitat = await runtime.bondService.update({
      id: 'bond-request-habitat',
      lifeId: 'life-phase21-targets',
      targetId: 'habitat-target',
      targetType: 'habitat',
      habitatId: 'habitat-target',
      delta: {
        familiarity: 0.2,
      },
      createdAt: 1000,
    })

    const thread = await runtime.bondService.update({
      id: 'bond-request-thread',
      lifeId: 'life-phase21-targets',
      targetId: 'thread-target',
      targetType: 'thread',
      threadId: 'thread-target',
      delta: {
        familiarity: 0.3,
      },
      createdAt: 2000,
    })

    expect(habitat.bond.targetType).toBe('habitat')
    expect(thread.bond.targetType).toBe('thread')

    const result = await runtime.bondService.retrieve({
      lifeId: 'life-phase21-targets',
      limit: 10,
    })
    expect(result.bonds.map((bond: Bond) => bond.targetType).sort()).toEqual(['habitat', 'thread'])

    await runtime.stop()
  })
})
