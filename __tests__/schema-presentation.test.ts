import { describe, expect, it } from 'vitest'

import { Config as behaviorConfig } from '../packages/elysia-ai-behavior/src/index.js'
import { Config as brainConfig } from '../packages/elysia-ai-brain/src/index.js'
import { Config as cognitionConfig } from '../packages/elysia-ai-cognition/src/index.js'
import { Config as homeostasisConfig } from '../packages/elysia-ai-homeostasis/src/index.js'
import { Config as modelGatewayConfig } from '../packages/elysia-ai-model-gateway/src/index.js'
import { Config as perceptionConfig } from '../packages/elysia-ai-perception/src/index.js'
import { Config as runtimeConfig } from '../packages/elysia-ai-runtime/src/index.js'

interface SerializedSchemaNode {
  type: string
  meta: {
    collapse?: boolean
    description?: string
  }
  dict?: Record<string, number>
  list?: number[]
}

interface SerializedSchema {
  uid: number
  refs: Record<string, SerializedSchemaNode>
}

function serialize(schema: { toJSON(): unknown }): SerializedSchema {
  return schema.toJSON() as unknown as SerializedSchema
}

function getNode(schema: SerializedSchema, uid: number): SerializedSchemaNode {
  return schema.refs[String(uid)]
}

function findObjects(schema: { toJSON(): unknown }, description: string): SerializedSchemaNode[] {
  return Object.values(serialize(schema).refs).filter((node) => {
    return node.type === 'object' && node.meta.description === description
  })
}

function findObjectsWithField(schema: { toJSON(): unknown }, field: string): SerializedSchemaNode[] {
  return Object.values(serialize(schema).refs).filter((node) => {
    return node.type === 'object' && field in (node.dict ?? {})
  })
}

describe('Koishi plugin schema presentation', () => {
  it('keeps model-gateway policy switches and branch fields in the same unions', () => {
    const schema = serialize(modelGatewayConfig)
    const root = getNode(schema, schema.uid)
    const rootTypes = root.list?.map((uid) => getNode(schema, uid).type)

    expect(rootTypes).toEqual(['object', 'object', 'object', 'union', 'object', 'union', 'object', 'union'])

    const policies = [
      ['maxRetries', ['maxRetries', 'baseDelayMs', 'maxDelayMs']],
      ['failureThreshold', ['failureThreshold', 'cooldownMs']],
      ['fallbackOnNonRetryable', ['slots', 'fallbackOnNonRetryable']],
    ] as const

    for (const [branchKey, branchFields] of policies) {
      const branches = findObjectsWithField(modelGatewayConfig, branchKey)
      expect(branches).toHaveLength(1)
      expect(branches[0].meta.collapse).not.toBe(true)
      expect(branches.some((branch) => branchFields.every((field) => field in (branch.dict ?? {})))).toBe(true)
    }
  })

  it('resolves model-gateway policy defaults and explicit branches', () => {
    const defaults = modelGatewayConfig({} as never)
    expect(defaults).toMatchObject({
      enableRetry: true,
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      enableCircuitBreaker: false,
      enableFallback: false,
    })

    const retryDisabled = modelGatewayConfig({ enableRetry: false } as never)
    expect(retryDisabled.enableRetry).toBe(false)
    expect(retryDisabled).not.toHaveProperty('maxRetries')
    expect(retryDisabled).not.toHaveProperty('baseDelayMs')
    expect(retryDisabled).not.toHaveProperty('maxDelayMs')

    const policiesEnabled = modelGatewayConfig({
      enableRetry: true,
      maxRetries: 5,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      enableCircuitBreaker: true,
      failureThreshold: 4,
      cooldownMs: 10000,
      enableFallback: true,
      slots: { primary: ['backup'] },
      fallbackOnNonRetryable: true,
    } as never)
    expect(policiesEnabled).toMatchObject({
      enableRetry: true,
      maxRetries: 5,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      enableCircuitBreaker: true,
      failureThreshold: 4,
      cooldownMs: 10000,
      enableFallback: true,
      slots: { primary: ['backup'] },
      fallbackOnNonRetryable: true,
    })
  })

  it.each([
    ['密度合并器（何时唤醒 LLM）', behaviorConfig],
    ['短期记忆（events pack 存档）', behaviorConfig],
    ['高级：上下文预算', brainConfig],
    ['高级：稳态调参', homeostasisConfig],
    ['MongoDB 持久化', runtimeConfig],
  ])('applies collapse directly to the %s object', (description, schema) => {
    const groups = findObjects(schema, description)
    expect(groups).toHaveLength(1)
    expect(groups[0].meta.collapse).toBe(true)
  })

  it('keeps cognition event-injection groups expanded', () => {
    const feedGroups = findObjects(cognitionConfig, '事件清单（events 变量）')
    const historyGroups = findObjects(cognitionConfig, '事件历史')

    expect(feedGroups).toHaveLength(1)
    expect(feedGroups[0].meta.collapse).not.toBe(true)
    expect(historyGroups).toHaveLength(1)
    expect(historyGroups[0].meta.collapse).not.toBe(true)
  })

  it('perception 无 AI 增强分支（触发器重构后回归规则版富化）', () => {
    const resolved = perceptionConfig({} as never)
    expect(resolved).toMatchObject({
      enabledIntentClassify: true,
      enabledEntityExtract: true,
      enabledSentiment: true,
    })
    expect(resolved).not.toHaveProperty('aiEnhanced')
    expect(resolved).not.toHaveProperty('maxInputTokens')
  })

  it('resolves cognition event-injection defaults and overrides', () => {
    const defaults = cognitionConfig({} as never)
    expect(defaults).toMatchObject({
      events: {
        enabled: true,
        feed: { maxEvents: 30 },
        history: { maxEvents: 100, windowMs: 1800000 },
      },
    })

    const customized = cognitionConfig({
      events: {
        enabled: true,
        enabledEvents: { 'member-removed': false },
        feed: { include: { 'member-removed': false }, maxEvents: 10 },
        history: { maxEvents: 50, windowMs: 60000 },
      },
    } as never)
    expect(customized).toMatchObject({
      events: {
        enabledEvents: { 'member-removed': false },
        feed: { include: { 'member-removed': false }, maxEvents: 10 },
        history: { maxEvents: 50, windowMs: 60000 },
      },
    })
  })
})
