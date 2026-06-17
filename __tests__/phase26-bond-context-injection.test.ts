import { describe, expect, it } from 'vitest'
import { Context } from 'koishi'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type {
  Bond,
  BondContextItem,
  BrainRequest,
  CoreEventMap,
  DialogueTask,
} from '../packages/@elysia-ai/core/src/index.js'
import { DefaultBrainService } from '../packages/@elysia-ai/brain/src/index.js'
import { DefaultDialogueService } from '../packages/@elysia-ai/dialogue/src/service.js'
import {
  MemoryBondRepository,
  RuleBasedBondContextProvider,
} from '../packages/@elysia-ai/bond/src/index.js'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { apply as applyBondPlugin } from '../packages/elysia-ai-bond/src/index.js'

function createBond(patch: Partial<Bond> & { id: string; targetId: string; targetType: Bond['targetType'] }): Bond {
  return {
    id: patch.id,
    lifeId: patch.lifeId ?? 'life-phase26',
    targetId: patch.targetId,
    targetType: patch.targetType,
    status: patch.status ?? 'active',
    metrics: patch.metrics ?? {
      familiarity: 0.5,
      intimacy: 0.3,
      trust: 0.6,
      tension: 0.1,
      dependence: 0.2,
    },
    summary: patch.summary,
    tags: patch.tags,
    actorId: patch.actorId,
    habitatId: patch.habitatId,
    threadId: patch.threadId,
    projectionId: patch.projectionId,
    createdAt: patch.createdAt ?? 1000,
    updatedAt: patch.updatedAt ?? 1000,
    lastInteractionAt: patch.lastInteractionAt ?? 1000,
    interactionCount: patch.interactionCount ?? 1,
    metadata: patch.metadata,
  }
}

describe('Phase 26 Bond Context Injection v1', () => {
  it('RuleBasedBondContextProvider 浼氭寜 actor / thread / habitat 鍙洖骞舵帓搴忓叧绯讳笂涓嬫枃', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const selectedEvents: any[] = []
    eventBus.on('bond.context.selected', (payload) => {
      selectedEvents.push(payload)
    })

    const repository = new MemoryBondRepository()
    await repository.save(createBond({
      id: 'bond-phase26-actor',
      targetId: 'actor-phase26',
      targetType: 'actor',
      actorId: 'actor-phase26',
      summary: 'The actor is a familiar friend.',
      interactionCount: 12,
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))
    await repository.save(createBond({
      id: 'bond-phase26-thread',
      targetId: 'thread-phase26',
      targetType: 'thread',
      threadId: 'thread-phase26',
      summary: 'The thread is about co-op games.',
      interactionCount: 5,
      updatedAt: Date.now() - 1000,
      lastInteractionAt: Date.now() - 1000,
    }))
    await repository.save(createBond({
      id: 'bond-phase26-habitat',
      targetId: 'habitat-phase26',
      targetType: 'habitat',
      habitatId: 'habitat-phase26',
      summary: 'The habitat is a relaxed group chat.',
      interactionCount: 3,
      updatedAt: Date.now() - 2000,
      lastInteractionAt: Date.now() - 2000,
    }))
    await repository.save(createBond({
      id: 'bond-phase26-other',
      targetId: 'actor-other',
      targetType: 'actor',
      actorId: 'actor-other',
      summary: 'Unrelated actor.',
      interactionCount: 100,
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))

    const provider = new RuleBasedBondContextProvider(repository, eventBus as any, {
      defaultLimit: 5,
    })

    const context = await provider.buildContext({
      lifeId: 'life-phase26',
      actorId: 'actor-phase26',
      habitatId: 'habitat-phase26',
      threadId: 'thread-phase26',
      limit: 5,
    })

    const ids = context.items.map((item: BondContextItem) => item.bond.id)
    expect(ids).toContain('bond-phase26-actor')
    expect(ids).toContain('bond-phase26-thread')
    expect(ids).toContain('bond-phase26-habitat')
    expect(ids).not.toContain('bond-phase26-other')
    expect(context.items[0].score).toBeGreaterThanOrEqual(context.items[1].score)
    expect(selectedEvents).toHaveLength(1)
  })

  it('RuleBasedBondContextProvider 浼氫繚鐣欓珮 tension 鍏崇郴鐢ㄤ簬璋ㄦ厧鍥炲', async () => {
    const repository = new MemoryBondRepository()
    await repository.save(createBond({
      id: 'bond-phase26-tension',
      targetId: 'actor-phase26',
      targetType: 'actor',
      actorId: 'actor-phase26',
      metrics: {
        familiarity: 0.2,
        intimacy: 0.05,
        trust: 0.2,
        tension: 0.9,
        dependence: 0.1,
      },
      summary: 'Recent disagreement requires careful tone.',
      interactionCount: 2,
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))

    const provider = new RuleBasedBondContextProvider(repository)
    const context = await provider.buildContext({
      lifeId: 'life-phase26',
      actorId: 'actor-phase26',
      limit: 1,
    })

    expect(context.items).toHaveLength(1)
    expect(context.items[0].bond.id).toBe('bond-phase26-tension')
    expect(context.items[0].matchedBy).toContain('metrics')
    expect(context.items[0].reason).toContain('tension')
  })

  it('DefaultDialogueService 浼氭妸 bond context 娉ㄥ叆 BrainRequest', async () => {
    const brainRequests: BrainRequest[] = []
    const brainService = {
      async execute(request: BrainRequest) {
        brainRequests.push(request)
        return {
          output: 'reply with bond context',
          messages: request.messages,
          capability: request.capability,
          metadata: {
            source: 'phase26-brain-mock',
          },
        }
      },
    }

    const bondContextProvider = {
      async buildContext() {
        return {
          lifeId: 'life-phase26-dialogue',
          actorId: 'actor-phase26-dialogue',
          mode: 'rule-based' as const,
          items: [
            {
              bond: createBond({
                id: 'bond-phase26-dialogue',
                lifeId: 'life-phase26-dialogue',
                targetId: 'actor-phase26-dialogue',
                targetType: 'actor',
                actorId: 'actor-phase26-dialogue',
                summary: 'The user is trusted.',
              }),
              score: 0.9,
              reason: 'same actor target',
              matchedBy: ['actor' as const],
            },
          ],
          totalCandidates: 1,
          createdAt: 1000,
        }
      },
    }

    const service = new DefaultDialogueService(
      brainService as any,
      undefined,
      10,
      undefined,
      bondContextProvider,
    )

    const task: DialogueTask = {
      lifeId: 'life-phase26-dialogue',
      habitatId: 'habitat-phase26-dialogue',
      scope: {
        type: 'user',
        key: 'actor-phase26-dialogue',
      },
      sourceStimulusIds: ['stim-phase26-dialogue'],
      mode: 'reply-now',
      messages: [],
      metadata: {
        actorId: 'actor-phase26-dialogue',
        currentUserContent: 'How close are we?',
      },
    }

    const result = await service.execute(task)

    expect(result.output).toBe('reply with bond context')
    expect(brainRequests).toHaveLength(1)
    expect(brainRequests[0].bondContext?.items).toHaveLength(1)
    expect(brainRequests[0].metadata?.bondContextItemCount).toBe(1)
  })

  it('DefaultBrainService 浼氭妸 bond context 娉ㄥ叆 gateway system message', async () => {
    const gatewayRequests: any[] = []
    const gateway = {
      async execute(request: any) {
        gatewayRequests.push(request)
        return {
          output: 'brain output',
          messages: request.messages,
          provider: {
            id: 'phase26-provider',
            type: 'custom',
            model: 'phase26-model',
          },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
          metadata: {
            source: 'phase26-gateway-mock',
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
      lifeId: 'life-phase26-brain',
      capability: 'dialogue-generation',
      messages: [
        {
          role: 'user',
          content: 'Please respond with relationship awareness',
        },
      ],
      bondContext: {
        lifeId: 'life-phase26-brain',
        mode: 'rule-based',
        items: [
          {
            bond: createBond({
              id: 'bond-phase26-brain',
              lifeId: 'life-phase26-brain',
              targetId: 'actor-phase26-brain',
              targetType: 'actor',
              summary: 'A trusted long-term friend.',
              metrics: {
                familiarity: 0.8,
                intimacy: 0.4,
                trust: 0.9,
                tension: 0.1,
                dependence: 0.2,
              },
            }),
            score: 0.95,
            reason: 'same actor target',
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
    expect(gatewayRequests[0].messages[0].content).toContain('Relevant relationship context:')
    expect(gatewayRequests[0].messages[0].content).toContain('trust=0.90')
    expect(gatewayRequests[0].messages[0].content).toContain('A trusted long-term friend.')
    expect(gatewayRequests[0].metadata).toMatchObject({
      hasBondContext: true,
      bondContextItemCount: 1,
    })
  })

  it('bond plugin 安装后回填 runtime bondContextProvider', async () => {
    const runtime = createDefaultRuntime()
    const ctx = new Context() as any
    ctx['elysia-ai-runtime'] = runtime
    applyBondPlugin(ctx, { enabled: true, contextLimit: 5 })
    await runtime.bondRepository!.save(createBond({
      id: 'bond-phase26-runtime',
      lifeId: 'life-phase26-runtime',
      targetId: 'actor-phase26-runtime',
      targetType: 'actor',
      actorId: 'actor-phase26-runtime',
      summary: 'Runtime actor is familiar.',
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))

    const context = await runtime.bondContextProvider!.buildContext({
      lifeId: 'life-phase26-runtime',
      actorId: 'actor-phase26-runtime',
    })

    expect(context.items).toHaveLength(1)
    expect(context.items[0].bond.id).toBe('bond-phase26-runtime')
  })
})
