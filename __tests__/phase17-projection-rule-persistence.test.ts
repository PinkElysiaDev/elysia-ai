/**
 * Phase 17 Projection Rule Persistence 集成测试
 *
 * 验证 projection rules 从纯内存 registry 走向 repository + service：
 * 1. MemoryProjectionRuleRepository 可保存 / 查询 / 删除规则
 * 2. ProjectionRuleService 可从 repository 加载 enabled rules 到 registry
 * 3. upsertRule() 后 resolver 立即命中新规则并发出事件
 * 4. disableRule() 后 resolver 不再命中该规则并发出事件
 * 5. removeRule() 后 registry / repository 均删除该规则并发出事件
 * 6. manifest projection rules 会同步写入 repository + registry
 */

import { afterEach, describe, expect, it } from 'vitest'
import type {
  CoreEventMap,
  ProjectionRule,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import { createDefaultRuntime, type Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import { MemoryProjectionRuleRepository } from '../packages/elysia-ai-runtime/src/projection/memory-projection-rule-repository.js'
import { MemoryProjectionRegistry } from '../packages/elysia-ai-runtime/src/projection/registry.js'
import { DefaultProjectionRuleService } from '../packages/elysia-ai-runtime/src/projection/projection-rule-service.js'

function createStimulus(id: string, channelId = 'channel-phase17-a'): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase17',
    actorId: 'user-phase17',
    channelId,
    platform: 'qq',
    botId: 'bot-phase17',
    payload: {
      content: 'hello projection rule persistence',
    },
  }
}

function createRule(id: string, lifeId: string, channelId = 'channel-phase17-a'): ProjectionRule {
  return {
    id,
    lifeId,
    enabled: true,
    priority: 100,
    habitatId: 'habitat-phase17',
    channelId,
    platform: 'qq',
    botId: 'bot-phase17',
  }
}

describe('Phase 17 Projection Rule Persistence 集成测试', () => {
  let runtime: Runtime | undefined

  afterEach(async () => {
    if (runtime?.getState() === 'running') await runtime.stop()
    runtime = undefined
  })

  it('MemoryProjectionRuleRepository 可保存 / 查询 / 删除规则', async () => {
    const repository = new MemoryProjectionRuleRepository()
    const rule = createRule('rule-phase17-repo', 'life-phase17-repo')

    await repository.save(rule)

    await expect(repository.getById('rule-phase17-repo')).resolves.toEqual(rule)
    await expect(repository.listByLifeId('life-phase17-repo')).resolves.toEqual([rule])
    await expect(repository.listEnabled()).resolves.toEqual([rule])
    await expect(repository.listAll()).resolves.toEqual([rule])

    await repository.remove('rule-phase17-repo')

    await expect(repository.getById('rule-phase17-repo')).resolves.toBeNull()
    await expect(repository.listAll()).resolves.toEqual([])
  })

  it('ProjectionRuleService 可从 repository 加载 enabled rules 到 registry', async () => {
    runtime = createDefaultRuntime()
    const repository = new MemoryProjectionRuleRepository()
    const registry = new MemoryProjectionRegistry()
    const enabledRule = createRule('rule-phase17-load-enabled', 'life-phase17-load')
    const disabledRule = {
      ...createRule('rule-phase17-load-disabled', 'life-phase17-load'),
      enabled: false,
    }

    await repository.save(enabledRule)
    await repository.save(disabledRule)

    const service = new DefaultProjectionRuleService(
      repository,
      registry,
      runtime.context.eventBus,
      runtime.context.logger,
    )

    await service.loadFromRepository()

    expect(registry.getById('rule-phase17-load-enabled')).toEqual(enabledRule)
    expect(registry.getById('rule-phase17-load-disabled')).toBeUndefined()
  })

  it('upsertRule() 后 resolver 立即命中新规则并发出 projection.rule.updated', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-phase17-upsert', type: 'elysia-default' }],
    })

    const updatedEvents: CoreEventMap['projection.rule.updated'][] = []
    const routedEvents: CoreEventMap['projection.routed'][] = []

    runtime.context.eventBus.on('projection.rule.updated', (payload) => {
      updatedEvents.push(payload)
    })
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    const rule = createRule('rule-phase17-upsert', 'life-phase17-upsert')
    await runtime.projectionRuleService.upsertRule(rule)

    await expect(runtime.projectionRuleRepository.getById('rule-phase17-upsert')).resolves.toEqual(rule)
    expect(runtime.projectionRegistry.getById('rule-phase17-upsert')).toEqual(rule)
    expect(updatedEvents).toEqual([{ ruleId: 'rule-phase17-upsert', rule }])

    await runtime.receiveStimulus(createStimulus('stim-phase17-upsert'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual(['life-phase17-upsert'])
    expect(routedEvents[0].routing.projectionIds).toEqual(['rule-phase17-upsert'])
  })

  it('disableRule() 后 resolver 不再命中该规则并发出 projection.rule.disabled', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-phase17-disable', type: 'elysia-default' }],
    })

    const disabledEvents: CoreEventMap['projection.rule.disabled'][] = []
    const routedEvents: CoreEventMap['projection.routed'][] = []

    runtime.context.eventBus.on('projection.rule.disabled', (payload) => {
      disabledEvents.push(payload)
    })
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    const rule = createRule('rule-phase17-disable', 'life-phase17-disable')
    await runtime.projectionRuleService.upsertRule(rule)
    await runtime.projectionRuleService.disableRule('rule-phase17-disable')

    const persisted = await runtime.projectionRuleRepository.getById('rule-phase17-disable')
    expect(persisted?.enabled).toBe(false)
    expect(runtime.projectionRegistry.getById('rule-phase17-disable')?.enabled).toBe(false)
    expect(disabledEvents).toHaveLength(1)
    expect(disabledEvents[0].ruleId).toBe('rule-phase17-disable')
    expect(disabledEvents[0].rule.enabled).toBe(false)

    await runtime.receiveStimulus(createStimulus('stim-phase17-disable'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual([])
    expect(routedEvents[0].routing.metadata?.mode).toBe('projection-rules')
  })

  it('removeRule() 后 registry / repository 均删除该规则并发出 projection.rule.removed', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-phase17-remove-target', type: 'elysia-default' },
        { id: 'life-phase17-remove-sentinel', type: 'elysia-default' },
      ],
    })

    const removedEvents: CoreEventMap['projection.rule.removed'][] = []
    const routedEvents: CoreEventMap['projection.routed'][] = []

    runtime.context.eventBus.on('projection.rule.removed', (payload) => {
      removedEvents.push(payload)
    })
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    const targetRule = createRule('rule-phase17-remove-target', 'life-phase17-remove-target')
    const sentinelRule = createRule(
      'rule-phase17-remove-sentinel',
      'life-phase17-remove-sentinel',
      'channel-phase17-other',
    )

    await runtime.projectionRuleService.upsertRule(targetRule)
    await runtime.projectionRuleService.upsertRule(sentinelRule)
    await runtime.projectionRuleService.removeRule('rule-phase17-remove-target')

    await expect(runtime.projectionRuleRepository.getById('rule-phase17-remove-target')).resolves.toBeNull()
    expect(runtime.projectionRegistry.getById('rule-phase17-remove-target')).toBeUndefined()
    expect(runtime.projectionRegistry.getById('rule-phase17-remove-sentinel')).toEqual(sentinelRule)
    expect(removedEvents).toEqual([{ ruleId: 'rule-phase17-remove-target' }])

    await runtime.receiveStimulus(createStimulus('stim-phase17-remove'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual([])
    expect(routedEvents[0].routing.metadata?.mode).toBe('projection-rules')
  })

  it('manifest projection rules 会同步写入 repository + registry', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()

    const updatedEvents: CoreEventMap['projection.rule.updated'][] = []
    runtime.context.eventBus.on('projection.rule.updated', (payload) => {
      updatedEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-phase17-manifest',
        type: 'elysia-default',
        extensions: {
          projection: {
            rules: [{
              id: 'rule-phase17-manifest',
              priority: 100,
              habitatId: 'habitat-phase17',
              channelId: 'channel-phase17-a',
              platform: 'qq',
              botId: 'bot-phase17',
            }],
          },
        },
      }],
    })

    const persisted = await runtime.projectionRuleRepository.getById('rule-phase17-manifest')
    const registered = runtime.projectionRegistry.getById('rule-phase17-manifest')

    expect(persisted?.lifeId).toBe('life-phase17-manifest')
    expect(registered?.lifeId).toBe('life-phase17-manifest')
    expect(updatedEvents).toHaveLength(1)
    expect(updatedEvents[0].ruleId).toBe('rule-phase17-manifest')

    const routedEvents: CoreEventMap['projection.routed'][] = []
    runtime.context.eventBus.on('projection.routed', (payload) => {
      routedEvents.push(payload)
    })

    await runtime.receiveStimulus(createStimulus('stim-phase17-manifest'))

    expect(routedEvents).toHaveLength(1)
    expect(routedEvents[0].routing.lifeIds).toEqual(['life-phase17-manifest'])
    expect(routedEvents[0].routing.projectionIds).toEqual(['rule-phase17-manifest'])
  })
})
