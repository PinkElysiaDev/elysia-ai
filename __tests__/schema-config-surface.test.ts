import { describe, expect, it } from 'vitest'
import type { Schema } from 'koishi'

import { Config as behaviorConfig } from '../packages/elysia-ai-behavior/src/index.js'
import { Config as brainConfig } from '../packages/elysia-ai-brain/src/index.js'
import { Config as cognitionConfig } from '../packages/elysia-ai-cognition/src/index.js'
import { Config as homeostasisConfig } from '../packages/elysia-ai-homeostasis/src/index.js'
import { Config as modelGatewayConfig } from '../packages/elysia-ai-model-gateway/src/index.js'
import { Config as perceptionConfig } from '../packages/elysia-ai-perception/src/index.js'
import { Config as runtimeConfig } from '../packages/elysia-ai-runtime/src/index.js'

type SchemaNode = Schema & {
  dict?: Record<string, SchemaNode>
  list?: SchemaNode[]
  meta: {
    collapse?: boolean
    description?: string
  }
}

function findObjectWithKey(schema: SchemaNode, key: string): SchemaNode | undefined {
  if (schema.type === 'object' && schema.dict?.[key]) return schema
  for (const child of Object.values(schema.dict ?? {})) {
    const match = findObjectWithKey(child, key)
    if (match) return match
  }
  for (const child of schema.list ?? []) {
    const match = findObjectWithKey(child, key)
    if (match) return match
  }
}

function findProperty(schema: SchemaNode, key: string): SchemaNode | undefined {
  if (schema.type === 'object' && schema.dict?.[key]) return schema.dict[key]
  for (const child of Object.values(schema.dict ?? {})) {
    const match = findProperty(child, key)
    if (match) return match
  }
  for (const child of schema.list ?? []) {
    const match = findProperty(child, key)
    if (match) return match
  }
}

function findFieldOwner(schema: SchemaNode, key: string): SchemaNode | undefined {
  if (schema.type === 'object' && schema.dict?.[key]) return schema
  for (const child of Object.values(schema.dict ?? {})) {
    const match = findFieldOwner(child, key)
    if (match) return match
  }
  for (const child of schema.list ?? []) {
    const match = findFieldOwner(child, key)
    if (match) return match
  }
}

function findUnionWithKey(schema: SchemaNode, key: string): SchemaNode | undefined {
  if (schema.type === 'union' && schema.list?.some((branch) => findObjectWithKey(branch, key))) return schema
  for (const child of schema.list ?? []) {
    const match = findUnionWithKey(child, key)
    if (match) return match
  }
}

function findBranchWithKey(schema: SchemaNode, key: string): SchemaNode {
  const branch = schema.list?.find((item) => item.type === 'object' && item.dict?.[key])
  expect(branch).toBeTruthy()
  return branch!
}

function collectCollapsedIntersects(schema: SchemaNode): SchemaNode[] {
  const matches = schema.type === 'intersect' && schema.meta.collapse ? [schema] : []
  return matches.concat(...(schema.list ?? []).map(collectCollapsedIntersects))
}

describe('Koishi plugin schema surface', () => {
  it('exposes retry, circuit-breaker and fallback settings from their enabled branches', () => {
    const retryUnion = findUnionWithKey(modelGatewayConfig as SchemaNode, 'maxRetries')!
    const circuitUnion = findUnionWithKey(modelGatewayConfig as SchemaNode, 'failureThreshold')!
    const fallbackUnion = findUnionWithKey(modelGatewayConfig as SchemaNode, 'fallbackOnNonRetryable')!

    expect(findObjectWithKey(modelGatewayConfig as SchemaNode, 'enableRetry')?.meta.collapse).not.toBe(true)
    expect(findBranchWithKey(retryUnion, 'maxRetries').meta.collapse).not.toBe(true)
    expect(findBranchWithKey(circuitUnion, 'failureThreshold').meta.collapse).not.toBe(true)
    expect(findBranchWithKey(fallbackUnion, 'fallbackOnNonRetryable').meta.collapse).not.toBe(true)

    expect(modelGatewayConfig({ enableRetry: true })).toMatchObject({
      enableRetry: true,
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    })
    const retryDisabled = modelGatewayConfig({ enableRetry: false })
    expect(retryDisabled).toMatchObject({
      enableRetry: false,
      enableCircuitBreaker: false,
      enableFallback: false,
    })
    expect(retryDisabled).not.toHaveProperty('maxRetries')
    expect(retryDisabled).not.toHaveProperty('baseDelayMs')
    expect(retryDisabled).not.toHaveProperty('maxDelayMs')
    expect(modelGatewayConfig({ enableCircuitBreaker: true })).toMatchObject({
      enableCircuitBreaker: true,
      failureThreshold: 3,
      cooldownMs: 30000,
    })
    expect(modelGatewayConfig({ enableFallback: true })).toMatchObject({
      enableFallback: true,
      fallbackOnNonRetryable: false,
    })
  })

  it('attaches collapse metadata to the concrete advanced configuration objects', () => {
    expect(findProperty(behaviorConfig as SchemaNode, 'batcher')?.meta.collapse).toBe(true)
    expect(findProperty(behaviorConfig as SchemaNode, 'packMemory')?.meta.collapse).toBe(true)
    expect(findProperty(brainConfig as SchemaNode, 'contextBudget')?.meta.collapse).toBe(true)
    expect(findProperty(homeostasisConfig as SchemaNode, 'dynamics')?.meta.collapse).toBe(true)
    expect(findObjectWithKey(runtimeConfig as SchemaNode, 'uri')?.meta.collapse).toBe(true)

    expect(findFieldOwner(behaviorConfig as SchemaNode, 'quietWindowMs')?.meta.collapse).toBe(true)
    expect(findFieldOwner(brainConfig as SchemaNode, 'maxMemoryChars')?.meta.collapse).toBe(true)
    expect(findFieldOwner(homeostasisConfig as SchemaNode, 'initialEnergy')?.meta.collapse).toBe(true)
    expect(findFieldOwner(cognitionConfig as SchemaNode, 'enabledEvents')?.meta.description).toBe('事件注入配置')

    for (const config of [behaviorConfig, brainConfig, cognitionConfig, homeostasisConfig]) {
      expect(collectCollapsedIntersects(config.toJSON() as SchemaNode)).toEqual([])
    }
  })

  it('keeps advanced values inside their collapsible configuration objects', () => {
    expect(behaviorConfig({} as never)).toMatchObject({
      enableReply: true,
      batcher: {
        quietWindowMs: 8000,
        dmQuietWindowMs: 1500,
        maxWaitMs: 30000,
        densityWindowMs: 10000,
        densityThreshold: 15,
        maxBatch: 50,
      },
      packMemory: {
        maxPacks: 12,
        injectPacks: 2,
      },
    })
    expect(brainConfig({} as never)).toMatchObject({
      contextBudget: {
        maxMemoryChars: 4000,
        maxBondChars: 3000,
        maxPersonaChars: 2000,
        maxSystemPromptChars: 12000,
        tokenEstimateRatio: 4,
      },
    })
    expect(homeostasisConfig({} as never)).toMatchObject({
      dynamics: {
        initialEnergy: 0.8,
        initialMood: 0.6,
        maxValue: 1,
        minValue: 0,
      },
    })
    // cognition：事件注入配置（events 总开关 / 事件清单 / 事件历史）
    expect(cognitionConfig({} as never)).toMatchObject({
      events: {
        enabled: true,
        feed: { maxEvents: 30 },
        history: { maxEvents: 100, windowMs: 1800000 },
      },
    })
  })

  it('perception 规则版富化开关保持展开（AI 逐条分析已随触发器重构移除）', () => {
    const intentSwitch = findObjectWithKey(perceptionConfig as SchemaNode, 'enabledIntentClassify')!
    expect(intentSwitch.meta.collapse).not.toBe(true)
    expect(findObjectWithKey(perceptionConfig as SchemaNode, 'aiEnhanced')).toBeUndefined()
  })
})
