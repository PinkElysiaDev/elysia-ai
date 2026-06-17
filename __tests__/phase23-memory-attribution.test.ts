import { describe, expect, it } from 'vitest'
import { Context } from 'koishi'
import type { MemoryUpdateRequest } from '../packages/@elysia-ai/core/src/index.js'
import { apply as applyMemoryPlugin } from '../packages/elysia-ai-memory/src/index.js'
import {
  DeterministicMemoryAttributor,
  DefaultMemoryService,
  MemoryMemoryRepository,
} from '../packages/@elysia-ai/memory/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'

function installMemoryPlugin(runtime: ReturnType<typeof createDefaultRuntime>) {
  const ctx = new Context() as any
  ctx['elysia-ai-runtime'] = runtime
  applyMemoryPlugin(ctx, { enabled: true, contextLimit: 5 })
  return ctx['elysia.memory']
}

describe('Phase 23 Memory Attribution & Routing v1', () => {
  it('DeterministicMemoryAttributor routes contextual memory to thread owner', async () => {
    const attributor = new DeterministicMemoryAttributor()

    const result = await attributor.attribute({
      id: 'memory-attribution-thread',
      lifeId: 'life-phase23',
      actorId: 'actor-phase23',
      habitatId: 'habitat-phase23',
      threadId: 'thread-phase23',
      content: 'actor likes strawberry cake',
      createdAt: 1000,
    })

    expect(result.mode).toBe('deterministic')
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]).toMatchObject({
      ownerType: 'thread',
      ownerId: 'thread-phase23',
      visibility: 'shared',
      scope: 'thread',
      attributionMode: 'deterministic',
    })
    expect(result.requests[0].relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: 'actor', targetId: 'actor-phase23', role: 'participant' }),
      expect.objectContaining({ targetType: 'habitat', targetId: 'habitat-phase23', role: 'location' }),
      expect.objectContaining({ targetType: 'thread', targetId: 'thread-phase23', role: 'subject' }),
    ]))
  })

  it('MemoryService.update applies deterministic attribution when attribution is omitted', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    await runtime.start()

    const result = await runtime.memoryService!.update({
      id: 'memory-request-phase23-implicit-attribution',
      lifeId: 'life-phase23-implicit',
      actorId: 'actor-phase23-implicit',
      content: 'implicit actor memory',
      createdAt: 1000,
      source: { stimulusId: 'stim-phase23-implicit' },
    })

    expect(result.created).toBe(true)
    expect(result.entry).toMatchObject({
      lifeId: 'life-phase23-implicit',
      actorId: 'actor-phase23-implicit',
      ownerType: 'actor',
      ownerId: 'actor-phase23-implicit',
      visibility: 'private',
      scope: 'actor',
      kind: 'episodic',
    })
    expect(result.entry.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: 'actor', targetId: 'actor-phase23-implicit', role: 'subject' }),
    ]))

    await runtime.stop()
  })

  it('MemoryService.processUpdateRequest supports multiple memories from custom attributor', async () => {
    const runtime = createDefaultRuntime()
    const memoryRepository = new MemoryMemoryRepository()
    runtime.memoryRepository = memoryRepository
    runtime.memoryService = new DefaultMemoryService(
      memoryRepository,
      runtime.context.eventBus,
      undefined,
      {
        attributor: {
          async attribute(request: MemoryUpdateRequest) {
            return {
              mode: 'ai-assisted',
              requests: [
                {
                  ...request,
                  id: `${request.id}:actor`,
                  ownerType: 'actor',
                  ownerId: request.actorId,
                  visibility: 'private',
                  scope: 'actor',
                  relations: [{ targetType: 'actor', targetId: request.actorId!, role: 'subject', confidence: 1 }],
                },
                {
                  ...request,
                  id: `${request.id}:habitat`,
                  ownerType: 'habitat',
                  ownerId: request.habitatId,
                  visibility: 'habitat',
                  scope: 'habitat',
                  relations: [
                    { targetType: 'habitat', targetId: request.habitatId!, role: 'subject', confidence: 1 },
                    { targetType: 'actor', targetId: request.actorId!, role: 'participant', confidence: 1 },
                  ],
                  metadata: { ...request.metadata, memoryId: 'memory-phase23-shared' },
                },
              ],
            }
          },
        },
      },
    )

    const result = await (runtime.memoryService! as any).processUpdateRequest({
      id: 'memory-request-phase23-multi',
      lifeId: 'life-phase23-multi',
      actorId: 'actor-phase23-multi',
      habitatId: 'habitat-phase23-multi',
      content: 'multi memory request',
      createdAt: 1000,
    })

    expect(result.created).toBe(true)

    const actorMemories = await runtime.memoryService!.retrieve({
      lifeId: 'life-phase23-multi',
      ownerType: 'actor',
      ownerId: 'actor-phase23-multi',
    })
    const habitatMemories = await runtime.memoryService!.retrieve({
      lifeId: 'life-phase23-multi',
      ownerType: 'habitat',
      ownerId: 'habitat-phase23-multi',
    })

    expect(actorMemories.entries).toHaveLength(1)
    expect(habitatMemories.entries).toHaveLength(1)
  })

  it('MemoryRepository supports owner, relation, visibility and event queries', async () => {
    const repository = new MemoryMemoryRepository()
    await repository.save({
      id: 'memory-phase23-query',
      lifeId: 'life-phase23-query',
      scope: 'event',
      kind: 'episodic',
      status: 'active',
      content: 'game night plan',
      ownerType: 'event',
      ownerId: 'event-game-night',
      visibility: 'shared',
      eventType: 'plan',
      relations: [
        { targetType: 'actor', targetId: 'actor-a', role: 'participant', confidence: 1 },
        { targetType: 'actor', targetId: 'actor-b', role: 'participant', confidence: 1 },
        { targetType: 'habitat', targetId: 'habitat-query', role: 'location', confidence: 1 },
      ],
      importance: 0.8,
      confidence: 0.9,
      createdAt: 1000,
      updatedAt: 1000,
      accessCount: 0,
    })

    expect((await repository.query({ lifeId: 'life-phase23-query', ownerType: 'event', ownerId: 'event-game-night' })).total).toBe(1)
    expect((await repository.query({ lifeId: 'life-phase23-query', relationTargetType: 'actor', relationTargetId: 'actor-b', relationRole: 'participant' })).total).toBe(1)
    expect((await repository.query({ lifeId: 'life-phase23-query', visibility: 'shared', eventType: 'plan' })).total).toBe(1)
  })

  it('news metadata is routed as global semantic memory', async () => {
    const runtime = createDefaultRuntime()
    installMemoryPlugin(runtime)
    await runtime.start()

    const result = await runtime.memoryService!.update({
      id: 'memory-request-phase23-news',
      lifeId: 'life-phase23-news',
      content: 'A public news event happened',
      createdAt: 1000,
      metadata: { memoryCategory: 'news' },
    })

    expect(result.entry).toMatchObject({
      ownerType: 'global',
      ownerId: 'global',
      visibility: 'global',
      scope: 'global',
      kind: 'semantic',
      eventType: 'news',
    })

    await runtime.stop()
  })
})
