import { describe, expect, it, vi } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type { BrainRequest, CoreEventMap, DialogueTask, MemoryContextItem } from '../packages/@elysia-ai/core/src/index.js'
import { DefaultBrainService } from '../packages/@elysia-ai/brain/src/index.js'
import { DefaultDialogueService } from '../packages/@elysia-ai/dialogue/src/service.js'
import {
  MemoryMemoryRepository,
  RuleBasedMemoryContextProvider,
} from '../packages/elysia-ai-runtime/src/memory/index.js'

describe('Phase 24 Memory Context Injection v1', () => {
  it('RuleBasedMemoryContextProvider 会按 owner / visibility / relation 召回并排序上下文', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const repository = new MemoryMemoryRepository()
    const provider = new RuleBasedMemoryContextProvider(repository, eventBus, {
      defaultLimit: 3,
    })

    const selectedEvents: any[] = []
    eventBus.on('memory.context.selected', (payload) => {
      selectedEvents.push(payload)
    })

    await repository.save({
      id: 'memory-phase24-actor-private',
      lifeId: 'life-phase24',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content: 'actor-phase24 likes strawberry cake',
      actorId: 'actor-phase24',
      ownerType: 'actor',
      ownerId: 'actor-phase24',
      visibility: 'private',
      relations: [
        {
          targetType: 'actor',
          targetId: 'actor-phase24',
          role: 'subject',
          confidence: 1,
        },
      ],
      importance: 0.9,
      confidence: 0.9,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    })

    await repository.save({
      id: 'memory-phase24-thread-shared',
      lifeId: 'life-phase24',
      scope: 'thread',
      kind: 'episodic',
      status: 'active',
      content: 'thread discussed a co-op game plan',
      actorId: 'actor-phase24',
      habitatId: 'habitat-phase24',
      threadId: 'thread-phase24',
      ownerType: 'thread',
      ownerId: 'thread-phase24',
      visibility: 'shared',
      relations: [
        {
          targetType: 'actor',
          targetId: 'actor-phase24',
          role: 'participant',
          confidence: 1,
        },
      ],
      importance: 0.7,
      confidence: 0.8,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      accessCount: 0,
    })

    await repository.save({
      id: 'memory-phase24-other-private',
      lifeId: 'life-phase24',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content: 'another actor private memory',
      actorId: 'actor-other',
      ownerType: 'actor',
      ownerId: 'actor-other',
      visibility: 'private',
      importance: 1,
      confidence: 0.9,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    })

    const context = await provider.buildContext({
      lifeId: 'life-phase24',
      actorId: 'actor-phase24',
      habitatId: 'habitat-phase24',
      threadId: 'thread-phase24',
      content: 'I want strawberry cake while playing the game',
      limit: 5,
    })

    expect(context.mode).toBe('rule-based')
    expect(context.items.map((item: MemoryContextItem) => item.entry.id)).toContain('memory-phase24-actor-private')
    expect(context.items.map((item: MemoryContextItem) => item.entry.id)).toContain('memory-phase24-thread-shared')
    expect(context.items.map((item: MemoryContextItem) => item.entry.id)).not.toContain('memory-phase24-other-private')
    expect(context.items[0].score).toBeGreaterThanOrEqual(context.items[1].score)
    expect(selectedEvents).toHaveLength(1)
  })

  it('DefaultDialogueService 会把 memory context 注入 BrainRequest', async () => {
    const brainRequests: BrainRequest[] = []
    const brainService = {
      async execute(request: BrainRequest) {
        brainRequests.push(request)
        return {
          output: 'reply with memory context',
          messages: request.messages,
          capability: request.capability,
          metadata: {
            source: 'phase24-brain-mock',
          },
        }
      },
    }

    const memoryContextProvider = {
      buildContext: vi.fn(async () => ({
        lifeId: 'life-phase24-dialogue',
        actorId: 'actor-phase24-dialogue',
        mode: 'rule-based' as const,
        items: [
          {
            entry: {
              id: 'memory-phase24-dialogue',
              lifeId: 'life-phase24-dialogue',
              scope: 'actor' as const,
              kind: 'preference' as const,
              status: 'active' as const,
              content: 'actor likes tea',
              ownerType: 'actor' as const,
              ownerId: 'actor-phase24-dialogue',
              visibility: 'private' as const,
              importance: 0.8,
              confidence: 0.9,
              createdAt: 1000,
              updatedAt: 1000,
            },
            score: 0.9,
            reason: 'same actor owner',
            matchedBy: ['actor' as const],
          },
        ],
        totalCandidates: 1,
        createdAt: 1000,
      })),
    }

    const service = new DefaultDialogueService(
      brainService,
      undefined,
      10,
      memoryContextProvider,
    )

    const task: DialogueTask = {
      lifeId: 'life-phase24-dialogue',
      habitatId: 'habitat-phase24-dialogue',
      scope: {
        type: 'user',
        key: 'actor-phase24-dialogue',
      },
      sourceStimulusIds: ['stim-phase24-dialogue'],
      mode: 'reply-now',
      messages: [],
      metadata: {
        actorId: 'actor-phase24-dialogue',
        currentUserContent: 'What do I like to drink?',
      },
    }

    const result = await service.execute(task)

    expect(result.output).toBe('reply with memory context')
    expect(memoryContextProvider.buildContext).toHaveBeenCalledOnce()
    expect(brainRequests).toHaveLength(1)
    expect(brainRequests[0].memoryContext?.items).toHaveLength(1)
    expect(brainRequests[0].metadata?.memoryContextItemCount).toBe(1)
  })

  it('DefaultBrainService 会把 memory context 注入 gateway system message', async () => {
    const gatewayRequests: any[] = []
    const gateway = {
      async execute(request: any) {
        gatewayRequests.push(request)
        return {
          output: 'brain output',
          messages: request.messages,
          provider: {
            id: 'phase24-provider',
            type: 'custom',
            model: 'phase24-model',
          },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
          metadata: {
            source: 'phase24-gateway-mock',
          },
        }
      },
    }

    const service = new DefaultBrainService({
      systemPrompt: 'Base system prompt',
      contextWindow: 10,
    }, gateway)

    await service.execute({
      task: 'dialogue-generation',
      lifeId: 'life-phase24-brain',
      capability: 'dialogue-generation',
      messages: [
        {
          role: 'user',
          content: 'Please remember my favorite cake',
        },
      ],
      memoryContext: {
        lifeId: 'life-phase24-brain',
        mode: 'rule-based',
        items: [
          {
            entry: {
              id: 'memory-phase24-brain',
              lifeId: 'life-phase24-brain',
              scope: 'actor',
              kind: 'preference',
              status: 'active',
              content: 'User likes strawberry cake',
              ownerType: 'actor',
              ownerId: 'actor-phase24-brain',
              visibility: 'private',
              importance: 0.9,
              confidence: 0.9,
              createdAt: 1000,
              updatedAt: 1000,
            },
            score: 0.95,
            reason: 'same actor owner',
            matchedBy: ['actor'],
          },
        ],
        totalCandidates: 1,
        createdAt: 1000,
      },
    } as BrainRequest)

    expect(gatewayRequests).toHaveLength(1)
    expect(gatewayRequests[0].messages[0]).toMatchObject({
      role: 'system',
    })
    expect(gatewayRequests[0].messages[0].content).toContain('Relevant long-term memories:')
    expect(gatewayRequests[0].messages[0].content).toContain('User likes strawberry cake')
    expect(gatewayRequests[0].metadata).toMatchObject({
      hasMemoryContext: true,
      memoryContextItemCount: 1,
    })
  })
})
