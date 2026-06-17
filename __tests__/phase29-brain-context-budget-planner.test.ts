import { describe, expect, it, vi } from 'vitest'
import { DefaultBrainService } from '../packages/@elysia-ai/brain/src/index.js'
import {
  DefaultContextBudgetPlanner,
} from '../packages/@elysia-ai/brain/src/context-budget.js'
import type {
  ContextBudgetPlanInput,
  ContextBudgetPlanner,
} from '../packages/@elysia-ai/brain/src/context-budget.js'
import type {
  Bond,
  MemoryEntry,
} from '../packages/@elysia-ai/core/src/index.js'

function createMemoryEntry(patch: Partial<MemoryEntry> & { id: string; content: string }): MemoryEntry {
  return {
    id: patch.id,
    lifeId: patch.lifeId ?? 'life-phase29',
    scope: patch.scope ?? 'actor',
    kind: patch.kind ?? 'episodic',
    status: patch.status ?? 'active',
    content: patch.content,
    summary: patch.summary,
    ownerType: patch.ownerType ?? 'actor',
    ownerId: patch.ownerId ?? 'actor-phase29',
    visibility: patch.visibility ?? 'private',
    importance: patch.importance ?? 0.8,
    confidence: patch.confidence ?? 0.9,
    createdAt: patch.createdAt ?? 1000,
    updatedAt: patch.updatedAt ?? 1000,
    accessCount: patch.accessCount ?? 0,
  }
}

function createBond(patch: Partial<Bond> & { id: string; targetId: string; targetType: Bond['targetType'] }): Bond {
  return {
    id: patch.id,
    lifeId: patch.lifeId ?? 'life-phase29',
    targetId: patch.targetId,
    targetType: patch.targetType,
    status: patch.status ?? 'active',
    metrics: patch.metrics ?? {
      familiarity: 0.7,
      intimacy: 0.4,
      trust: 0.8,
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

function createBrainRequest(): any {
  return {
    task: 'dialogue-generation',
    lifeId: 'life-phase29',
    capability: 'dialogue-generation',
    messages: [
      { role: 'user', content: 'hello phase29' },
    ],
    memoryContext: {
      lifeId: 'life-phase29',
      mode: 'rule-based',
      items: [
        {
          entry: createMemoryEntry({
            id: 'memory-phase29',
            content: 'm'.repeat(500),
          }),
          score: 0.9,
          reason: 'long memory',
          matchedBy: ['actor'],
        },
      ],
      totalCandidates: 1,
      createdAt: 1000,
    },
    bondContext: {
      lifeId: 'life-phase29',
      mode: 'rule-based',
      items: [
        {
          bond: createBond({
            id: 'bond-phase29',
            targetId: 'actor-phase29',
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
  }
}

describe('Phase 29 Brain Context Budget Planner & Prompt Governance v1', () => {
  it('DefaultContextBudgetPlanner 会按 context 类型裁剪并输出 diagnostics', () => {
    const planner = new DefaultContextBudgetPlanner()
    const plan = planner.plan({
      systemPrompt: 'Base system prompt',
      personaContextText: 'p'.repeat(100),
      memoryContextText: 'm'.repeat(200),
      bondContextText: 'b'.repeat(180),
      maxPersonaChars: 80,
      maxMemoryChars: 90,
      maxBondChars: 70,
      maxSystemPromptChars: 220,
      tokenEstimateRatio: 5,
      maxEstimatedTokens: 44,
    })

    expect(plan.systemPrompt.length).toBeLessThanOrEqual(220)
    expect(plan.diagnostics).toMatchObject({
      strategy: 'char-estimate-v1',
      tokenEstimateRatio: 5,
      maxEstimatedTokens: 44,
      personaContextOriginalChars: 100,
      personaContextFinalChars: 80,
      personaContextTruncated: true,
      memoryContextOriginalChars: 200,
      memoryContextFinalChars: 90,
      memoryContextTruncated: true,
      bondContextOriginalChars: 180,
      bondContextFinalChars: 70,
      bondContextTruncated: true,
      systemPromptTruncated: true,
      systemPromptFinalChars: 220,
      estimatedSystemPromptTokens: 44,
    })
  })

  it('DefaultBrainService 会使用默认 planner 并保留 Phase 27 兼容 metadata', async () => {
    const gatewayRequests: any[] = []
    const gateway = {
      async execute(request: any) {
        gatewayRequests.push(request)
        return {
          output: 'phase29 output',
          messages: request.messages,
          metadata: {},
        }
      },
    }

    const service = new DefaultBrainService({
      systemPrompt: 'Base system prompt',
      contextBudget: {
        maxMemoryChars: 120,
        maxBondChars: 120,
        maxSystemPromptChars: 260,
        tokenEstimateRatio: 4,
      },
    }, gateway as any)

    await service.execute(createBrainRequest())

    expect(gatewayRequests).toHaveLength(1)
    expect(gatewayRequests[0].metadata).toMatchObject({
      memoryContextTruncated: true,
      bondContextTruncated: true,
      systemPromptTruncated: true,
      contextBudgetStrategy: 'char-estimate-v1',
      tokenEstimateRatio: 4,
      memoryContextPromptLength: 120,
      bondContextPromptLength: 120,
      memoryContextFinalChars: 120,
      bondContextFinalChars: 120,
      systemPromptFinalChars: 260,
    })
    expect(gatewayRequests[0].metadata.estimatedSystemPromptTokens).toBe(65)
    expect(gatewayRequests[0].messages[0].content.length).toBeLessThanOrEqual(260)
  })

  it('DefaultBrainService 支持注入自定义 ContextBudgetPlanner', async () => {
    const gatewayRequests: any[] = []
    const gateway = {
      async execute(request: any) {
        gatewayRequests.push(request)
        return {
          output: 'custom planner output',
          messages: request.messages,
          metadata: {},
        }
      },
    }
    const planner: ContextBudgetPlanner = {
      plan: vi.fn((input: ContextBudgetPlanInput) => ({
        systemPrompt: [
          input.systemPrompt,
          'custom-planner-system-prompt',
        ].filter(Boolean).join('\n'),
        diagnostics: {
          strategy: 'custom-test-planner',
          tokenEstimateRatio: input.tokenEstimateRatio ?? 4,
          maxEstimatedTokens: input.maxEstimatedTokens,
          memoryContextOriginalChars: input.memoryContextText?.length ?? 0,
          memoryContextFinalChars: 0,
          memoryContextTruncated: true,
          bondContextOriginalChars: input.bondContextText?.length ?? 0,
          bondContextFinalChars: 0,
          bondContextTruncated: true,
          personaContextOriginalChars: input.personaContextText?.length ?? 0,
          personaContextFinalChars: 0,
          personaContextTruncated: false,
          systemPromptOriginalChars: input.systemPrompt.length,
          systemPromptFinalChars: 'custom-planner-system-prompt'.length,
          systemPromptTruncated: false,
          estimatedSystemPromptTokens: 7,
        },
      })),
    }

    const service = new DefaultBrainService({
      systemPrompt: 'Base system prompt',
      contextBudget: {
        planner,
        tokenEstimateRatio: 3,
        maxEstimatedTokens: 128,
      },
    }, gateway as any)

    await service.execute(createBrainRequest())

    expect(planner.plan).toHaveBeenCalledOnce()
    expect(gatewayRequests).toHaveLength(1)
    expect(gatewayRequests[0].messages[0].content).toContain('custom-planner-system-prompt')
    expect(gatewayRequests[0].metadata).toMatchObject({
      contextBudgetStrategy: 'custom-test-planner',
      tokenEstimateRatio: 3,
      maxEstimatedTokens: 128,
      estimatedSystemPromptTokens: 7,
      memoryContextTruncated: true,
      bondContextTruncated: true,
    })
  })
})
