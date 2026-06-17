import { describe, expect, it } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/index.js'
import type {
  Bond,
  BondContextItem,
  BondRelevanceSelectionRequest,
  BrainRequest,
  CoreEventMap,
  MemoryContextItem,
  MemoryRelevanceSelectionRequest,
} from '../packages/@elysia-ai/core/src/index.js'
import {
  AiAssistedBondRelevanceSelector,
} from '../packages/elysia-ai-runtime/src/bond/index.js'
import {
  AiAssistedMemoryRelevanceSelector,
} from '../packages/elysia-ai-runtime/src/memory/index.js'

function createMemoryItem(id: string, score: number, content = id): MemoryContextItem {
  return {
    entry: {
      id,
      lifeId: 'life-phase28',
      scope: 'actor',
      kind: 'preference',
      status: 'active',
      content,
      ownerType: 'actor',
      ownerId: 'actor-phase28',
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

function createMemorySelectionRequest(candidates: MemoryContextItem[]): MemoryRelevanceSelectionRequest {
  return {
    contextRequest: {
      lifeId: 'life-phase28',
      actorId: 'actor-phase28',
      content: 'What should be recalled?',
      limit: 2,
    },
    candidates,
    content: 'What should be recalled?',
    limit: 2,
    mode: 'ai-assisted',
  }
}

function createBond(patch: Partial<Bond> & { id: string; targetId: string; targetType: Bond['targetType'] }): Bond {
  return {
    id: patch.id,
    lifeId: patch.lifeId ?? 'life-phase28',
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

function createBondItem(id: string, score: number, summary = `summary ${id}`): BondContextItem {
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

function createBondSelectionRequest(candidates: BondContextItem[]): BondRelevanceSelectionRequest {
  return {
    contextRequest: {
      lifeId: 'life-phase28',
      actorId: 'actor-phase28',
      habitatId: 'habitat-phase28',
      threadId: 'thread-phase28',
      limit: 2,
    },
    candidates,
    content: 'Respond with relationship awareness',
    limit: 2,
    mode: 'ai-assisted',
  }
}

function delayed<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

describe('Phase 28 Relevance Selection Production Governance', () => {
  it('memory AI selector invalid JSON 会 fallback 并记录 parseError metadata', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const failedEvents: any[] = []
    eventBus.on('memory.relevance.selection.failed', (payload) => {
      failedEvents.push(payload)
    })

    const brainService = {
      async execute(_request: BrainRequest) {
        return {
          output: 'not-json',
          capability: 'memory-relevance-selection',
          metadata: {
            source: 'phase28-invalid-json',
          },
        }
      },
    }

    const selector = new AiAssistedMemoryRelevanceSelector(brainService as any, eventBus as any)
    const result = await selector.select(createMemorySelectionRequest([
      createMemoryItem('memory-low', 0.2),
      createMemoryItem('memory-high', 0.9),
      createMemoryItem('memory-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.selectedIds).toEqual(['memory-high', 'memory-mid'])
    expect(result.fallbackReason).toContain('Unexpected token')
    expect(result.metadata).toMatchObject({
      selector: 'AiAssistedMemoryRelevanceSelector',
      fallbackSelector: 'RuleBasedMemoryRelevanceSelector',
      candidateCount: 3,
      selectedCount: 2,
      rejectedCount: 1,
      usedAI: false,
    })
    expect(result.metadata?.parseError).toContain('Unexpected token')
    expect(failedEvents).toHaveLength(1)
  })

  it('bond AI selector invalid selectedIds 会 fallback 并记录 diagnostics metadata', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const fallbackEvents: any[] = []
    eventBus.on('bond.relevance.selection.fallback', (payload) => {
      fallbackEvents.push(payload)
    })

    const brainService = {
      async execute(_request: BrainRequest) {
        return {
          output: JSON.stringify({
            selectedIds: ['invented-bond-id'],
            reason: 'invalid invented id',
          }),
          capability: 'bond-relevance-selection',
          metadata: {
            source: 'phase28-invalid-ids',
          },
        }
      },
    }

    const selector = new AiAssistedBondRelevanceSelector(brainService as any, eventBus as any)
    const result = await selector.select(createBondSelectionRequest([
      createBondItem('bond-low', 0.2),
      createBondItem('bond-high', 0.9),
      createBondItem('bond-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.selectedIds).toEqual(['bond-high', 'bond-mid'])
    expect(result.fallbackReason).toContain('no valid selectedIds')
    expect(result.metadata).toMatchObject({
      selector: 'AiAssistedBondRelevanceSelector',
      fallbackSelector: 'RuleBasedBondRelevanceSelector',
      candidateCount: 3,
      selectedCount: 2,
      rejectedCount: 1,
      usedAI: false,
      fallbackReason: 'bond relevance selection returned no valid selectedIds',
    })
    expect(fallbackEvents).toHaveLength(1)
  })

  it('memory AI selector timeout 会 fallback 并记录 timedOut metadata', async () => {
    const brainService = {
      async execute(_request: BrainRequest) {
        return delayed(50, {
          output: JSON.stringify({
            selectedIds: ['memory-high'],
          }),
          capability: 'memory-relevance-selection',
          metadata: {},
        })
      },
    }

    const selector = new AiAssistedMemoryRelevanceSelector(
      brainService as any,
      undefined,
      undefined,
      { timeoutMs: 1 },
    )
    const result = await selector.select(createMemorySelectionRequest([
      createMemoryItem('memory-low', 0.2),
      createMemoryItem('memory-high', 0.9),
      createMemoryItem('memory-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.fallbackReason).toContain('timed out')
    expect(result.metadata).toMatchObject({
      selector: 'AiAssistedMemoryRelevanceSelector',
      timedOut: true,
      timeoutMs: 1,
      usedAI: false,
    })
    expect(typeof result.metadata?.latencyMs).toBe('number')
  })

  it('bond AI selector timeout 会 fallback 并记录 timedOut metadata', async () => {
    const brainService = {
      async execute(_request: BrainRequest) {
        return delayed(50, {
          output: JSON.stringify({
            selectedIds: ['bond-high'],
          }),
          capability: 'bond-relevance-selection',
          metadata: {},
        })
      },
    }

    const selector = new AiAssistedBondRelevanceSelector(
      brainService as any,
      undefined,
      undefined,
      { timeoutMs: 1 },
    )
    const result = await selector.select(createBondSelectionRequest([
      createBondItem('bond-low', 0.2),
      createBondItem('bond-high', 0.9),
      createBondItem('bond-mid', 0.5),
    ]))

    expect(result.usedAI).toBe(false)
    expect(result.fallbackReason).toContain('timed out')
    expect(result.metadata).toMatchObject({
      selector: 'AiAssistedBondRelevanceSelector',
      timedOut: true,
      timeoutMs: 1,
      usedAI: false,
    })
    expect(typeof result.metadata?.latencyMs).toBe('number')
  })

  it('successful AI selectors expose aligned diagnostics metadata', async () => {
    const memoryBrain = {
      async execute(_request: BrainRequest) {
        return {
          output: JSON.stringify({
            selectedIds: ['memory-mid', 'memory-high'],
            reason: 'AI memory ordering',
          }),
          capability: 'memory-relevance-selection',
          metadata: {
            provider: 'mock',
          },
        }
      },
    }
    const bondBrain = {
      async execute(_request: BrainRequest) {
        return {
          output: JSON.stringify({
            selectedIds: ['bond-mid', 'bond-high'],
            reason: 'AI bond ordering',
          }),
          capability: 'bond-relevance-selection',
          metadata: {
            provider: 'mock',
          },
        }
      },
    }

    const memoryResult = await new AiAssistedMemoryRelevanceSelector(memoryBrain as any)
      .select(createMemorySelectionRequest([
        createMemoryItem('memory-low', 0.2),
        createMemoryItem('memory-high', 0.9),
        createMemoryItem('memory-mid', 0.5),
      ]))
    const bondResult = await new AiAssistedBondRelevanceSelector(bondBrain as any)
      .select(createBondSelectionRequest([
        createBondItem('bond-low', 0.2),
        createBondItem('bond-high', 0.9),
        createBondItem('bond-mid', 0.5),
      ]))

    expect(memoryResult.metadata).toMatchObject({
      selector: 'AiAssistedMemoryRelevanceSelector',
      candidateCount: 3,
      selectedCount: 2,
      rejectedCount: 1,
      usedAI: true,
      timedOut: false,
    })
    expect(bondResult.metadata).toMatchObject({
      selector: 'AiAssistedBondRelevanceSelector',
      candidateCount: 3,
      selectedCount: 2,
      rejectedCount: 1,
      usedAI: true,
      timedOut: false,
    })
    expect(typeof memoryResult.metadata?.latencyMs).toBe('number')
    expect(typeof bondResult.metadata?.latencyMs).toBe('number')
  })
})
