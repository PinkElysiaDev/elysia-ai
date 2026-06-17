import type {
  ProjectionResolver,
  ProjectionRoutingResult,
  ProjectionRule,
  Stimulus,
} from '@elysia-ai/core'
import type { LifeRegistry } from '../registry/life-registry.js'
import type { ProjectionRegistry } from './registry.js'

// ─────────────────────────────────────────────────
// Rule matching
// ─────────────────────────────────────────────────

function isRuleEnabled(rule: ProjectionRule): boolean {
  return rule.enabled !== false
}

function hasRuleConstraint(rule: ProjectionRule): boolean {
  return Boolean(
    rule.habitatId ||
    rule.channelId ||
    rule.threadId ||
    rule.actorId ||
    rule.platform ||
    rule.botId,
  )
}

function matchOptionalField(
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  return expected === undefined || expected === actual
}

function matchesStimulus(rule: ProjectionRule, stimulus: Stimulus): boolean {
  return matchOptionalField(rule.habitatId, stimulus.habitatId) &&
    matchOptionalField(rule.channelId, stimulus.channelId) &&
    matchOptionalField(rule.threadId, stimulus.threadId) &&
    matchOptionalField(rule.actorId, stimulus.actorId) &&
    matchOptionalField(rule.platform, stimulus.platform) &&
    matchOptionalField(rule.botId, stimulus.botId)
}

function dedupeLifeIds(rules: ProjectionRule[]): string[] {
  const lifeIds: string[] = []
  for (const rule of rules) {
    if (!lifeIds.includes(rule.lifeId)) lifeIds.push(rule.lifeId)
  }
  return lifeIds
}

// ─────────────────────────────────────────────────
// Default resolver
// ─────────────────────────────────────────────────

/**
 * 默认 ProjectionResolver 实现
 *
 * Phase 13 起支持基于 ProjectionRule 的精确匹配：
 * - 未配置任何 rule 时，保留旧行为：全部活跃生命体均感知
 * - 配置 rule 后，仅命中规则的 active life 感知 stimulus
 * - rule 按 priority 从高到低排序
 */
export class DefaultProjectionResolver implements ProjectionResolver {
  constructor(
    private readonly lifeRegistry: LifeRegistry,
    private readonly projectionRegistry?: ProjectionRegistry,
  ) {}

  resolve(stimulus: Stimulus): ProjectionRoutingResult {
    const activeLives = this.lifeRegistry.getAll().filter((life) => life.status === 'active')
    const activeLifeIds = new Set(activeLives.map((life) => life.id))
    const rules = this.projectionRegistry?.list() ?? []

    if (rules.length === 0) {
      const lifeIds = activeLives.map((life) => life.id)

      return {
        stimulusId: stimulus.id,
        habitatId: stimulus.habitatId,
        lifeIds,
        projectionIds: lifeIds.map((id) => `proj-${id}-${stimulus.habitatId}`),
        routedAt: Date.now(),
        reason: lifeIds.length > 0
          ? `matched ${lifeIds.length} active life(s) via default resolver`
          : 'no active life instances found',
        metadata: {
          mode: 'fallback-all-active-lives',
        },
      }
    }

    const matchedRules = rules
      .filter(isRuleEnabled)
      .filter((rule) => activeLifeIds.has(rule.lifeId))
      .filter((rule) => hasRuleConstraint(rule))
      .filter((rule) => matchesStimulus(rule, stimulus))
      .sort((a, b) => b.priority - a.priority)

    const lifeIds = dedupeLifeIds(matchedRules)

    return {
      stimulusId: stimulus.id,
      habitatId: stimulus.habitatId,
      lifeIds,
      projectionIds: matchedRules.map((rule) => rule.id),
      matchedRules,
      routedAt: Date.now(),
      reason: lifeIds.length > 0
        ? `matched ${lifeIds.length} life(s) via projection rules`
        : 'no projection rule matched',
      metadata: {
        mode: 'projection-rules',
        ruleCount: rules.length,
        matchedRuleCount: matchedRules.length,
      },
    }
  }
}
