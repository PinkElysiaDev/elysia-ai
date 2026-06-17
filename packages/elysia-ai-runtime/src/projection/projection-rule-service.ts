import type {
  CoreEventMap,
  EventBus,
  ProjectionRule,
  ProjectionRuleRepository,
} from '@elysia-ai/core'
import type { RuntimeLogger } from '../context/index.js'
import type { ProjectionRegistry } from './registry.js'

export interface ProjectionRuleService {
  loadFromRepository(): Promise<void>
  upsertRule(rule: ProjectionRule): Promise<void>
  disableRule(id: string): Promise<void>
  removeRule(id: string): Promise<void>
  listRules(): Promise<ProjectionRule[]>
}

export class DefaultProjectionRuleService implements ProjectionRuleService {
  constructor(
    private readonly repository: ProjectionRuleRepository,
    private readonly registry: ProjectionRegistry,
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly logger?: RuntimeLogger,
  ) {}

  async loadFromRepository(): Promise<void> {
    const rules = await this.repository.listEnabled()
    for (const rule of rules) {
      this.registry.register(rule)
    }

    this.logger?.debug('projection rules loaded from repository', {
      phase: 'projection-rule-service',
      ruleCount: rules.length,
      ruleIds: rules.map((rule) => rule.id),
    })
  }

  async upsertRule(rule: ProjectionRule): Promise<void> {
    await this.repository.save(rule)
    this.registry.register(rule)

    await this.eventBus.emit('projection.rule.updated', {
      ruleId: rule.id,
      rule,
    })

    this.logger?.debug('projection rule upserted', {
      phase: 'projection-rule-service',
      ruleId: rule.id,
      lifeId: rule.lifeId,
      enabled: rule.enabled !== false,
    })
  }

  async disableRule(id: string): Promise<void> {
    const existing = await this.repository.getById(id)
    if (!existing) return

    const disabled: ProjectionRule = {
      ...existing,
      enabled: false,
    }

    await this.repository.save(disabled)
    this.registry.register(disabled)

    await this.eventBus.emit('projection.rule.disabled', {
      ruleId: id,
      rule: disabled,
    })

    this.logger?.debug('projection rule disabled', {
      phase: 'projection-rule-service',
      ruleId: id,
      lifeId: disabled.lifeId,
    })
  }

  async removeRule(id: string): Promise<void> {
    await this.repository.remove(id)
    this.registry.remove(id)

    await this.eventBus.emit('projection.rule.removed', {
      ruleId: id,
    })

    this.logger?.debug('projection rule removed', {
      phase: 'projection-rule-service',
      ruleId: id,
    })
  }

  async listRules(): Promise<ProjectionRule[]> {
    return this.repository.listAll()
  }
}
