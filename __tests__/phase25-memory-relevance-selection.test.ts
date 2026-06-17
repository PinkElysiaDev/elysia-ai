import { describe, expect, it, vi } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type {
  BrainRequest,
  CoreEventMap,
  MemoryContextItem,
  MemoryRelevanceSelectionRequest,
} from '../packages/@elysia-ai/core/src/index.js'
import {
  AiAssistedMemoryRelevanceSelector,
  MemoryMemoryRepository,
  RuleBasedMemoryContextProvider,
  RuleBasedMemoryRelevanceSelector,
} from '../packages/elysia-ai-runtime/src/memory/index.js'

function createItem(id: string, score: number, content = id): MemoryContextItem {
  return {
    entry: {
      id,
      lifeId: 'life-phase25',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content,
      ownerType: 'actor',
      ownerId: 'actor-phase25',
      visibility: 'private',
      importance: score,
      confidence: 0.9,
      createdAt: 1000 + Math.round(score * 100),
      updatedAt: 1000 + Math.round(score * 100),
    },
    score,
    reason: `score ${score}`,
    matchedBy: ['actor'],
  }
}

function createSelectionRequest(candidates: MemoryContextItem[]): MemoryRelevanceSelectionRequest {
  return {
    contextRequest: {
      lifeId: 'life-phase25',
      actorId: 'actor-phase25',
      content: 'What dessert do I like?',
      limit: 2,
    },
    candidates,
    content: 'What dessert do I like?',
    limit: 2,
    mode: 'ai-assisted',
  }
}

describe('Phase 25 Memory Relevance Selection v1', () => {
  it('RuleBasedMemoryRelevanceSelector 娴兼碍瀵?score 闁瀚?top memories', async () => {
    const selector = new RuleBasedMemoryRelevanceSelector()
    const result = await selector.select(createSelectionRequest([
      createItem('memory-low', 0.2),
      createItem('memory-high', 0.9),
      createItem('memory-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.selectedIds).toEqual(['memory-high', 'memory-mid'])
    expect(result.rejectedIds).toEqual(['memory-low'])
    expect(result.items.map((item: MemoryContextItem) => item.entry.id)).toEqual(['memory-high', 'memory-mid'])
  })

  it('AiAssistedMemoryRelevanceSelector 娴兼矮濞囬悽?brain JSON 缂佹挻鐏夐柌宥嗗笓楠炴儼袙闁?memories', async () => {
    const brainRequests: BrainRequest[] = []
    const brainService = {
      async execute(request: BrainRequest) {
        brainRequests.push(request)
        return {
          output: JSON.stringify({
            selectedIds: ['memory-tea', 'memory-cake'],
            reason: 'tea answers the drink question, cake is related preference',
            reasonById: {
              'memory-tea': 'directly answers current drink preference',
              'memory-cake': 'related dessert preference',
            },
          }),
          capability: request.capability,
          metadata: {
            source: 'phase25-brain-mock',
          },
        }
      },
    }

    const selector = new AiAssistedMemoryRelevanceSelector(brainService as any)
    const result = await selector.select(createSelectionRequest([
      createItem('memory-cake', 0.9, 'actor likes strawberry cake'),
      createItem('memory-tea', 0.5, 'actor likes tea'),
      createItem('memory-game', 0.8, 'actor likes co-op games'),
    ]))

    expect(brainRequests).toHaveLength(1)
    expect(brainRequests[0].capability).toBe('memory-relevance-selection')
    expect(result.usedAI).toBe(true)
    expect(result.selectedIds).toEqual(['memory-tea', 'memory-cake'])
    expect(result.items.map((item: MemoryContextItem) => item.entry.id)).toEqual(['memory-tea', 'memory-cake'])
    expect(result.items[0].reason).toContain('drink preference')
    expect(result.rejectedIds).toEqual(['memory-game'])
  })

  it('AiAssistedMemoryRelevanceSelector 閸?AI 婢惰精瑙﹂弮?fallback 閸?rule-based selector', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const fallbackEvents: any[] = []
    eventBus.on('memory.relevance.selection.fallback', (payload) => {
      fallbackEvents.push(payload)
    })

    const brainService = {
      async execute() {
        throw new Error('phase25 brain failure')
      },
    }

    const selector = new AiAssistedMemoryRelevanceSelector(brainService as any, eventBus as any)
    const result = await selector.select(createSelectionRequest([
      createItem('memory-low', 0.2),
      createItem('memory-high', 0.9),
      createItem('memory-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.fallbackReason).toContain('phase25 brain failure')
    expect(result.selectedIds).toEqual(['memory-high', 'memory-mid'])
    expect(fallbackEvents).toHaveLength(1)
  })

  it('RuleBasedMemoryContextProvider 閺€顖涘瘮闁俺绻?selector 閹恒儳顓搁張鈧紒鍫滅瑐娑撳鏋冮柅澶嬪', async () => {
    const repository = new MemoryMemoryRepository()
    await repository.save({
      id: 'memory-phase25-a',
      lifeId: 'life-phase25',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content: 'actor likes strawberry cake',
      actorId: 'actor-phase25',
      ownerType: 'actor',
      ownerId: 'actor-phase25',
      visibility: 'private',
      importance: 0.9,
      confidence: 0.9,
      createdAt: 1000,
      updatedAt: 1000,
      accessCount: 0,
    })
    await repository.save({
      id: 'memory-phase25-b',
      lifeId: 'life-phase25',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content: 'actor likes tea',
      actorId: 'actor-phase25',
      ownerType: 'actor',
      ownerId: 'actor-phase25',
      visibility: 'private',
      importance: 0.8,
      confidence: 0.9,
      createdAt: 2000,
      updatedAt: 2000,
      accessCount: 0,
    })

    const selector = {
      select: vi.fn(async (request: MemoryRelevanceSelectionRequest) => {
        const selected = request.candidates.find((item) => item.entry.id === 'memory-phase25-b')
        if (!selected) throw new Error('selected memory missing')
        return {
          items: [selected],
          selectedIds: ['memory-phase25-b'],
          rejectedIds: request.candidates
            .filter((item) => item.entry.id !== 'memory-phase25-b')
            .map((item) => item.entry.id),
          reason: 'mock selector selected tea',
          usedAI: true,
        }
      }),
    }

    const provider = new RuleBasedMemoryContextProvider(repository, undefined, {
      selector,
      defaultLimit: 2,
    })

    const context = await provider.buildContext({
      lifeId: 'life-phase25',
      actorId: 'actor-phase25',
      content: 'What do I like to drink?',
      limit: 2,
    })

    expect(selector.select).toHaveBeenCalledOnce()
    expect(context.mode).toBe('ai-assisted')
    expect(context.items.map((item) => item.entry.id)).toEqual(['memory-phase25-b'])
    expect(context.metadata?.relevanceSelectionReason).toBe('mock selector selected tea')
  })

  it('Memory plugin provider 支持注入 memoryRelevanceSelector', async () => {
    const selector = {
      select: vi.fn(async (request: MemoryRelevanceSelectionRequest) => {
        const [first] = request.candidates
        return {
          items: first ? [first] : [],
          selectedIds: first ? [first.entry.id] : [],
          rejectedIds: request.candidates.slice(1).map((item) => item.entry.id),
          reason: 'plugin injected selector',
          usedAI: true,
        }
      }),
    }
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const repository = new MemoryMemoryRepository()
    const provider = new RuleBasedMemoryContextProvider(repository, eventBus, {
      selector,
    })

    await repository.save({
      id: 'memory-phase25-plugin',
      lifeId: 'life-phase25-plugin',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content: 'plugin actor likes tea',
      actorId: 'actor-phase25-plugin',
      ownerType: 'actor',
      ownerId: 'actor-phase25-plugin',
      visibility: 'private',
      importance: 0.9,
      confidence: 0.9,
      createdAt: 1000,
      updatedAt: 1000,
      accessCount: 0,
    })

    const context = await provider.buildContext({
      lifeId: 'life-phase25-plugin',
      actorId: 'actor-phase25-plugin',
      content: 'tea',
    })

    expect(selector.select).toHaveBeenCalledOnce()
    expect(context.mode).toBe('ai-assisted')
    expect(context.items).toHaveLength(1)
  })})
