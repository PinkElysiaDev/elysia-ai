import { describe, expect, it, vi } from 'vitest'
import { Context } from 'koishi'
import type {
  CoreEventMap,
  MemoryEntry,
  ResponsePlan,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createBehaviorExecutionPlan } from '../packages/@elysia-ai/behavior/src/execution-plan.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { apply as applyMemoryPlugin } from '../packages/elysia-ai-memory/src/index.js'
import { MemoryMemoryRepository } from '../packages/@elysia-ai/memory/src/index.js'


function installMemoryPlugin(runtime: ReturnType<typeof createDefaultRuntime>) {
  const ctx = new Context() as any
  ctx['elysia-ai-runtime'] = runtime
  applyMemoryPlugin(ctx, { enabled: true, contextLimit: 5 })
  return ctx['elysia.memory']
}
function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: 1000,
    habitatId: 'habitat-phase20',
    actorId: 'actor-phase20',
    threadId: 'thread-phase20',
    channelId: 'channel-phase20',
    platform: 'qq',
    botId: 'bot-phase20',
    payload: {
      content: 'phase20 memory likes strawberries',
    },
  }
}

function createPlan(): ResponsePlan {
  return {
    scope: {
      type: 'user',
      key: 'actor-phase20',
    },
    sourceStimulusIds: ['stim-phase20'],
    mode: 'internal-update-only',
    plannerSource: 'program',
    shouldEnterDialogue: false,
    shouldUpdateMemory: true,
    shouldUpdateBond: false,
    shouldUpdateHomeostasis: false,
    shouldScheduleFollowup: false,
    reason: 'phase20 memory system test',
  }
}

describe('Phase 20 Memory System v1 integration tests', () => {
  it('BehaviorExecution memory-update action writes MemoryEntry and emits memory.created', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    const observatory = new DefaultObservatoryService(100)
    const createdEvents: CoreEventMap['memory.created'][] = []

    ;(runtime.context.eventBus as any).on('memory.created', (payload: CoreEventMap['memory.created']) => {
      createdEvents.push(payload)
      observatory.recordEvent('memory.created', payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase20')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase20',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(createdEvents).toHaveLength(1)

    const entry = createdEvents[0].entry
    expect(entry.lifeId).toBe('life-phase20')
    expect(entry.actorId).toBe('actor-phase20')
    expect(entry.habitatId).toBe('habitat-phase20')
    expect(entry.threadId).toBe('thread-phase20')
    expect(entry.scope).toBe('actor')
    expect(entry.kind).toBe('episodic')
    expect(entry.status).toBe('active')
    expect(entry.content).toBe('phase20 memory likes strawberries')
    expect(entry.source?.stimulusId).toBe('stim-phase20')
    expect(entry.source?.executionPlanId).toBe(plan.id)

    const stored = await runtime.memoryRepository!.listByStimulusId('stim-phase20')
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(entry.id)

    const trace = observatory.getRecentEvents()
    expect(trace[0]).toMatchObject({
      kind: 'memory',
      event: 'memory.created',
      memoryId: entry.id,
      memoryRequestId: createdEvents[0].requestId,
      lifeId: 'life-phase20',
      habitatId: 'habitat-phase20',
      scopeType: 'actor',
    })

    await runtime.stop()
  })

  it('MemoryService supports querying and retrieve access stats', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    const retrievedEvents: CoreEventMap['memory.retrieved'][] = []

    ;(runtime.context.eventBus as any).on('memory.retrieved', (payload: CoreEventMap['memory.retrieved']) => {
      retrievedEvents.push(payload)
    })

    await runtime.start()

    await runtime.memoryService!.update({
      id: 'memory-request-query-1',
      lifeId: 'life-phase20-query',
      actorId: 'actor-a',
      habitatId: 'habitat-a',
      threadId: 'thread-a',
      scope: 'actor',
      kind: 'preference',
      content: 'user prefers strawberry cake',
      tags: ['food', 'preference'],
      importance: 0.9,
      confidence: 0.8,
      createdAt: 1000,
      source: {
        stimulusId: 'stim-query-1',
        createdBy: 'phase20-test',
      },
    })

    await runtime.memoryService!.update({
      id: 'memory-request-query-2',
      lifeId: 'life-phase20-query',
      actorId: 'actor-b',
      habitatId: 'habitat-a',
      threadId: 'thread-b',
      scope: 'actor',
      kind: 'episodic',
      content: 'another actor talks about tea',
      tags: ['drink'],
      importance: 0.4,
      confidence: 0.7,
      createdAt: 2000,
      source: {
        stimulusId: 'stim-query-2',
        createdBy: 'phase20-test',
      },
    })

    const result = await runtime.memoryService!.retrieve({
      lifeId: 'life-phase20-query',
      actorId: 'actor-a',
      habitatId: 'habitat-a',
      threadId: 'thread-a',
      kind: 'preference',
      scope: 'actor',
      tags: ['food'],
      text: 'strawberry',
      minImportance: 0.8,
      limit: 10,
    })

    expect(result.total).toBe(1)
    expect(result.entries[0]).toMatchObject({
      lifeId: 'life-phase20-query',
      actorId: 'actor-a',
      kind: 'preference',
      accessCount: 1,
    })
    expect(result.entries[0].lastAccessedAt).toBeDefined()
    expect(retrievedEvents).toHaveLength(1)
    expect(retrievedEvents[0].result.entries).toHaveLength(1)

    await runtime.stop()
  })

  it('MemoryService merges duplicate updates from same source stimulus and emits memory.updated', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    const updatedEvents: CoreEventMap['memory.updated'][] = []

    ;(runtime.context.eventBus as any).on('memory.updated', (payload: CoreEventMap['memory.updated']) => {
      updatedEvents.push(payload)
    })

    await runtime.start()

    const first = await runtime.memoryService!.update({
      id: 'memory-request-merge-1',
      lifeId: 'life-phase20-merge',
      actorId: 'actor-merge',
      stimulusId: 'stim-merge',
      content: 'first memory content',
      tags: ['first'],
      importance: 0.3,
      confidence: 0.6,
      createdAt: 1000,
    })

    const second = await runtime.memoryService!.update({
      id: 'memory-request-merge-2',
      lifeId: 'life-phase20-merge',
      actorId: 'actor-merge',
      stimulusId: 'stim-merge',
      content: 'updated memory content',
      tags: ['second'],
      importance: 0.8,
      confidence: 0.9,
      createdAt: 2000,
    })

    expect(second.created).toBe(false)
    expect(second.updated).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.entry.content).toBe('updated memory content')
    expect(second.entry.tags).toEqual(['first', 'second'])
    expect(second.entry.importance).toBe(0.8)

    const stored = await runtime.memoryRepository!.listByStimulusId('stim-merge')
    expect(stored).toHaveLength(1)

    await runtime.stop()
  })

  it('MemoryService consolidate creates consolidated memory and archives old entries', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    const consolidatedEvents: CoreEventMap['memory.consolidated'][] = []

    ;(runtime.context.eventBus as any).on('memory.consolidated', (payload: CoreEventMap['memory.consolidated']) => {
      consolidatedEvents.push(payload)
    })

    await runtime.start()

    await runtime.memoryService!.update({
      id: 'memory-request-consolidate-1',
      lifeId: 'life-phase20-consolidate',
      actorId: 'actor-consolidate',
      kind: 'preference',
      content: 'likes strawberry',
      tags: ['food'],
      importance: 0.6,
      confidence: 0.7,
      createdAt: 1000,
      source: { stimulusId: 'stim-consolidate-1' },
    })

    await runtime.memoryService!.update({
      id: 'memory-request-consolidate-2',
      lifeId: 'life-phase20-consolidate',
      actorId: 'actor-consolidate',
      kind: 'preference',
      content: 'likes cake',
      tags: ['food'],
      importance: 0.7,
      confidence: 0.8,
      createdAt: 2000,
      source: { stimulusId: 'stim-consolidate-2' },
    })

    const result = await runtime.memoryService!.consolidate({
      id: 'memory-consolidation-request-1',
      lifeId: 'life-phase20-consolidate',
      actorId: 'actor-consolidate',
      kind: 'preference',
      tags: ['food'],
      createdAt: 3000,
    })

    expect(result.created).toBe(true)
    expect(result.consolidatedEntry?.content).toContain('likes strawberry')
    expect(result.consolidatedEntry?.content).toContain('likes cake')
    expect(result.archivedEntryIds).toHaveLength(1)
    expect(consolidatedEvents).toHaveLength(1)

    const active = await runtime.memoryService!.retrieve({
      lifeId: 'life-phase20-consolidate',
      actorId: 'actor-consolidate',
      status: 'active',
      kind: 'preference',
      tags: ['food'],
      limit: 10,
    })
    expect(active.entries.some((entry: MemoryEntry) => entry.id === result.consolidatedEntry?.id)).toBe(true)

    await runtime.stop()
  })

  it('MemoryService emits memory.update.failed without breaking execution result', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    const failedEvents: CoreEventMap['memory.update.failed'][] = []
    const repository = runtime.memoryRepository! as MemoryMemoryRepository
    const saveSpy = vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('phase20 save failure'))

    ;(runtime.context.eventBus as any).on('memory.update.failed', (payload: CoreEventMap['memory.update.failed']) => {
      failedEvents.push(payload)
    })

    await runtime.start()

    const stimulus = createStimulus('stim-phase20-failure')
    const plan = createBehaviorExecutionPlan({
      stimulus,
      lifeId: 'life-phase20-failure',
      plan: createPlan(),
      now: 1000,
    })

    const result = await runtime.behaviorExecution.execute(plan)

    expect(result.completed).toBe(true)
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].request.lifeId).toBe('life-phase20-failure')

    saveSpy.mockRestore()
    await runtime.stop()
  })
})
