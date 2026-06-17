import { describe, expect, it } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type {
  Bond,
  BondContextItem,
  BondRelevanceSelectionRequest,
  BrainRequest,
  CoreEventMap,
} from '../packages/@elysia-ai/core/src/index.js'
import { DefaultBrainService } from '../packages/@elysia-ai/brain/src/index.js'
import {
  AiAssistedBondRelevanceSelector,
  MemoryBondRepository,
  RuleBasedBondContextProvider,
  RuleBasedBondRelevanceSelector,
} from '../packages/elysia-ai-runtime/src/bond/index.js'

function createBond(patch: Partial<Bond> & { id: string; targetId: string; targetType: Bond['targetType'] }): Bond {
  return {
    id: patch.id,
    lifeId: patch.lifeId ?? 'life-phase27',
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

function createContextItem(id: string, score: number, summary = `summary ${id}`): BondContextItem {
  return {
    bond: createBond({
      id,
      targetId: id,
      targetType: 'actor',
      summary,
      updatedAt: 1000 + Math.round(score * 100),
    }),
    score,
    reason: `score ${score}`,
    matchedBy: ['actor'],
  }
}

function createSelectionRequest(candidates: BondContextItem[], limit = 2): BondRelevanceSelectionRequest {
  return {
    contextRequest: {
      lifeId: 'life-phase27',
      actorId: 'actor-phase27',
      habitatId: 'habitat-phase27',
      threadId: 'thread-phase27',
      limit,
    },
    candidates,
    content: 'Please respond with relationship awareness',
    limit,
    mode: 'ai-assisted',
  }
}

describe('Phase 27 Bond Relevance Selection & Context Budget Governance v1', () => {
  it('RuleBasedBondRelevanceSelector 浼氭寜 score 閫夋嫨 top bonds', async () => {
    const selector = new RuleBasedBondRelevanceSelector()
    const result = await selector.select(createSelectionRequest([
      createContextItem('bond-low', 0.2),
      createContextItem('bond-high', 0.9),
      createContextItem('bond-mid', 0.6),
    ], 2))

    expect(result.usedAI).toBe(false)
    expect(result.selectedIds).toEqual(['bond-high', 'bond-mid'])
    expect(result.rejectedIds).toEqual(['bond-low'])
    expect(result.items.map((item) => item.bond.id)).toEqual(['bond-high', 'bond-mid'])
  })

  it('AiAssistedBondRelevanceSelector 浼氫娇鐢?brain JSON 缁撴灉閲嶆帓骞惰В閲?bonds', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const completedEvents: any[] = []
    eventBus.on('bond.relevance.selection.completed', (payload: any) => {
      completedEvents.push(payload)
    })

    const brainRequests: BrainRequest[] = []
    const brain = {
      async execute(request: BrainRequest) {
        brainRequests.push(request)
        return {
          output: JSON.stringify({
            selectedIds: ['bond-mid', 'bond-high'],
            reason: 'AI picked relationship-aware ordering',
            reasonById: {
              'bond-mid': 'Most relevant current tension',
              'bond-high': 'Trusted relationship background',
            },
          }),
          messages: request.messages,
          capability: request.capability,
          metadata: {
            source: 'phase27-brain-mock',
          },
        }
      },
    }

    const selector = new AiAssistedBondRelevanceSelector(brain as any, eventBus as any)
    const result = await selector.select(createSelectionRequest([
      createContextItem('bond-low', 0.2),
      createContextItem('bond-high', 0.9),
      createContextItem('bond-mid', 0.6),
    ], 2))

    expect(result.usedAI).toBe(true)
    expect(result.selectedIds).toEqual(['bond-mid', 'bond-high'])
    expect(result.items[0].reason).toBe('Most relevant current tension')
    expect(brainRequests[0].capability).toBe('bond-relevance-selection')
    expect(completedEvents).toHaveLength(1)
  })

  it('AiAssistedBondRelevanceSelector 鍦?AI 澶辫触鏃?fallback 鍒?rule-based selector', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const fallbackEvents: any[] = []
    eventBus.on('bond.relevance.selection.fallback', (payload: any) => {
      fallbackEvents.push(payload)
    })

    const brain = {
      async execute() {
        throw new Error('phase27 AI failure')
      },
    }

    const selector = new AiAssistedBondRelevanceSelector(brain as any, eventBus as any)
    const result = await selector.select(createSelectionRequest([
      createContextItem('bond-low', 0.2),
      createContextItem('bond-high', 0.9),
      createContextItem('bond-mid', 0.6),
    ], 2))

    expect(result.usedAI).toBe(false)
    expect(result.fallbackReason).toContain('phase27 AI failure')
    expect(result.selectedIds).toEqual(['bond-high', 'bond-mid'])
    expect(fallbackEvents).toHaveLength(1)
  })

  it('RuleBasedBondContextProvider 鏀寔閫氳繃 selector 鎺ョ鏈€缁堜笂涓嬫枃閫夋嫨', async () => {
    const repository = new MemoryBondRepository()
    await repository.save(createBond({
      id: 'bond-phase27-a',
      targetId: 'actor-phase27',
      targetType: 'actor',
      actorId: 'actor-phase27',
      summary: 'Actor relation',
      interactionCount: 10,
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))
    await repository.save(createBond({
      id: 'bond-phase27-thread',
      targetId: 'thread-phase27',
      targetType: 'thread',
      threadId: 'thread-phase27',
      summary: 'Thread relation selected by custom selector',
      interactionCount: 5,
      updatedAt: Date.now() - 1000,
      lastInteractionAt: Date.now() - 1000,
    }))

    const selector = {
      async select(request: BondRelevanceSelectionRequest) {
        const selected = request.candidates.filter((item) => item.bond.id === 'bond-phase27-thread')
        return {
          items: selected,
          selectedIds: selected.map((item) => item.bond.id),
          rejectedIds: request.candidates
            .filter((item) => item.bond.id !== 'bond-phase27-thread')
            .map((item) => item.bond.id),
          reason: 'custom-selector',
          usedAI: true,
        }
      },
    }

    const provider = new RuleBasedBondContextProvider(repository, undefined, {
      selector,
    })
    const context = await provider.buildContext({
      lifeId: 'life-phase27',
      actorId: 'actor-phase27',
      threadId: 'thread-phase27',
      limit: 1,
    })

    expect(context.mode).toBe('ai-assisted')
    expect(context.items).toHaveLength(1)
    expect(context.items[0].bond.id).toBe('bond-phase27-thread')
    expect(context.metadata?.relevanceSelectorUsedAI).toBe(true)
  })

  it('Bond plugin provider 支持注入 bondRelevanceSelector', async () => {
    const selector = new RuleBasedBondRelevanceSelector()
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const repository = new MemoryBondRepository()
    const provider = new RuleBasedBondContextProvider(repository, eventBus, {
      selector,
    })

    await repository.save(createBond({
      id: 'bond-phase27-plugin',
      lifeId: 'life-phase27-plugin',
      targetId: 'actor-phase27-plugin',
      targetType: 'actor',
      actorId: 'actor-phase27-plugin',
      updatedAt: Date.now(),
      lastInteractionAt: Date.now(),
    }))

    const context = await provider.buildContext({
      lifeId: 'life-phase27-plugin',
      actorId: 'actor-phase27-plugin',
    })

    expect(context.items).toHaveLength(1)
    expect(context.metadata?.relevanceSelectorUsedAI).toBe(false)
  })
  it('DefaultBrainService 浼氬 memory / bond context 鎵ц context budget 鎴柇骞惰褰?metadata', async () => {
    const gatewayRequests: any[] = []
    const gateway = {
      async execute(request: any) {
        gatewayRequests.push(request)
        return {
          output: 'budgeted output',
          messages: request.messages,
          metadata: {},
        }
      },
    }

    const service = new DefaultBrainService({
      systemPrompt: 'Base system prompt',
      contextWindow: 10,
      contextBudget: {
        maxMemoryChars: 120,
        maxBondChars: 120,
        maxSystemPromptChars: 260,
      },
    }, gateway as any)

    await (service as any).execute({
      task: 'dialogue-generation',
      lifeId: 'life-phase27-brain',
      capability: 'dialogue-generation',
      messages: [{ role: 'user', content: 'hello' }],
      memoryContext: {
        lifeId: 'life-phase27-brain',
        mode: 'rule-based',
        items: [
          {
            entry: {
              id: 'memory-phase27',
              lifeId: 'life-phase27-brain',
              scope: 'actor',
              kind: 'episodic',
              status: 'active',
              content: 'm'.repeat(500),
              importance: 0.9,
              confidence: 0.9,
              createdAt: 1000,
              updatedAt: 1000,
            },
            score: 0.9,
            reason: 'long memory',
            matchedBy: ['actor'],
          },
        ],
        totalCandidates: 1,
        createdAt: 1000,
      },
      bondContext: {
        lifeId: 'life-phase27-brain',
        mode: 'rule-based',
        items: [
          {
            bond: createBond({
              id: 'bond-phase27-brain',
              lifeId: 'life-phase27-brain',
              targetId: 'actor-phase27-brain',
              targetType: 'actor',
              summary: 'b'.repeat(500),
            }),
            score: 0.9,
            reason: 'long bond',
            matchedBy: ['actor'],
          },
        ],
        totalCandidates: 1,
        createdAt: 1000,
      },
    } as BrainRequest)

    expect(gatewayRequests).toHaveLength(1)
    expect(gatewayRequests[0].metadata).toMatchObject({
      memoryContextTruncated: true,
      bondContextTruncated: true,
      systemPromptTruncated: true,
    })
    expect(gatewayRequests[0].messages[0].content.length).toBeLessThanOrEqual(260)
  })
})
