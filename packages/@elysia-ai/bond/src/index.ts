import type {
  Bond,
  BondContextItem,
  BondContextMatchSource,
  BondContextPack,
  BondContextProvider,
  BondContextRequest,
  BondMetrics,
  BondQuery,
  BondQueryOptions,
  BondRelevanceSelectionRequest,
  BondRelevanceSelectionResult,
  BondRelevanceSelector,
  BondRepository,
  BondSearchResult,
  BondService,
  BondStatus,
  BondTargetType,
  BondUpdateRequest,
  BondUpdateResult,
  BrainService,
  CoreEventMap,
  EventBus,
} from '@elysia-ai/core'
import {
  AiAssistedRelevanceSelectorBase,
  MongoDocRepository,
  clampUnit,
  clampUnitOr,
} from '@elysia-ai/shared'


export const internalName = 'elysia-ai-bond'

export interface RuntimeLogger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface BondPluginService {
  repository: BondRepository
  service: BondService
  contextProvider: BondContextProvider
  relevanceSelector: BondRelevanceSelector
}

export interface BondRepositoryConfig {
  type?: 'memory' | 'mongo'
  mongo?: {
    /** MongoDB 连接 URL（用户自部署）。配了它即可内建 mongo 仓储，无需宿主注入 repositoryFactory。 */
    uri?: string
    /** 数据库名，默认 'elysia_ai'。 */
    database?: string
    collectionName?: string
    indexes?: boolean
  }
}

export interface Config {
  enabled: boolean
  contextLimit: number
  repository?: BondRepositoryConfig
}

export interface BondRepositoryFactoryOptions {
  config: Config
  logger: RuntimeLogger
}

export interface BondPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> } }
  config: Config
  logger: RuntimeLogger
  repository?: BondRepository
  repositoryFactory?: (options: BondRepositoryFactoryOptions) => BondRepository
}

export interface BondPluginRuntime {
  service: BondPluginService
  repository: BondRepository
  bondService: BondService
  contextProvider: BondContextProvider
  dispose(): void
}

let bondCounter = 0

function nextBondId(prefix = 'bond'): string {
  bondCounter += 1
  return `${prefix}-${Date.now()}-${bondCounter}`
}

function normalizeArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

function includesAny<T>(actual: T | undefined, expected: T[] | undefined): boolean {
  if (!expected || expected.length === 0) return true
  if (actual === undefined) return false
  return expected.includes(actual)
}

function hasAllTags(actual: string[] | undefined, expected: string[] | undefined): boolean {
  if (!expected || expected.length === 0) return true
  if (!actual || actual.length === 0) return false
  const actualSet = new Set(actual.map((tag) => tag.toLowerCase()))
  return expected.every((tag) => actualSet.has(tag.toLowerCase()))
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  return normalized.length > 0 ? normalized : undefined
}

function mergeTags(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  return normalizeTags([...(left ?? []), ...(right ?? [])])
}

function cloneBond(bond: Bond): Bond {
  return {
    ...bond,
    metrics: { ...bond.metrics },
    tags: bond.tags ? [...bond.tags] : undefined,
    source: bond.source ? { ...bond.source } : undefined,
    metadata: bond.metadata ? { ...bond.metadata } : undefined,
  }
}

function metricValue(bond: Bond, key: keyof BondMetrics): number {
  return bond.metrics[key]
}

function compareBonds(query: BondQuery): (a: Bond, b: Bond) => number {
  const orderBy = query.orderBy ?? 'updatedAt'
  const direction = query.order === 'asc' ? 1 : -1

  return (a, b) => {
    const left = orderBy === 'createdAt' || orderBy === 'updatedAt' || orderBy === 'interactionCount'
      ? a[orderBy] ?? 0
      : metricValue(a, orderBy)
    const right = orderBy === 'createdAt' || orderBy === 'updatedAt' || orderBy === 'interactionCount'
      ? b[orderBy] ?? 0
      : metricValue(b, orderBy)
    if (left === right) return b.updatedAt - a.updatedAt
    return (left - right) * direction
  }
}

function normalizeTargetType(targetType: BondTargetType | undefined): BondTargetType {
  if (!targetType) return 'actor'
  if (targetType === 'individual') return 'actor'
  if (targetType === 'collective') return 'habitat'
  if (targetType === 'channel') return 'habitat'
  return targetType
}

export interface RuleBasedBondContextProviderOptions {
  candidateLimit?: number
  defaultLimit?: number
  minScore?: number
  selector?: BondRelevanceSelector
}

export class RuleBasedBondRelevanceSelector implements BondRelevanceSelector {
  async select(request: BondRelevanceSelectionRequest): Promise<BondRelevanceSelectionResult> {
    const limit = request.limit ?? request.contextRequest.limit ?? 5
    const items = [...request.candidates]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return b.bond.updatedAt - a.bond.updatedAt
      })
      .slice(0, limit)
    const selectedIds = items.map((item) => item.bond.id)
    const selectedSet = new Set(selectedIds)

    return {
      items,
      selectedIds,
      rejectedIds: request.candidates
        .filter((item) => !selectedSet.has(item.bond.id))
        .map((item) => item.bond.id),
      reason: 'rule-based-score-ranking',
      usedAI: false,
      metadata: {
        selector: 'RuleBasedBondRelevanceSelector',
      },
    }
  }
}

export interface AiAssistedBondRelevanceSelectorOptions {
  maxCandidates?: number
  defaultLimit?: number
  fallbackSelector?: BondRelevanceSelector
  timeoutMs?: number
}

function sanitizeBondCandidate(item: BondContextItem): Record<string, unknown> {
  return {
    id: item.bond.id,
    targetId: item.bond.targetId,
    targetType: item.bond.targetType,
    metrics: item.bond.metrics,
    summary: item.bond.summary,
    tags: item.bond.tags,
    interactionCount: item.bond.interactionCount,
    score: item.score,
    reason: item.reason,
    matchedBy: item.matchedBy,
  }
}

export class AiAssistedBondRelevanceSelector
  extends AiAssistedRelevanceSelectorBase<BondContextItem, BondRelevanceSelectionRequest, BondRelevanceSelectionResult>
  implements BondRelevanceSelector {
  constructor(
    brainService: BrainService | undefined,
    eventBus?: EventBus<CoreEventMap>,
    logger?: RuntimeLogger,
    options: AiAssistedBondRelevanceSelectorOptions = {},
  ) {
    super(brainService, {
      selectorName: 'AiAssistedBondRelevanceSelector',
      task: 'bond-relevance-selection',
      logPhase: 'bond-relevance-selection',
      label: 'bond relevance selection',
      events: {
        requested: 'bond.relevance.selection.requested',
        completed: 'bond.relevance.selection.completed',
        failed: 'bond.relevance.selection.failed',
        fallback: 'bond.relevance.selection.fallback',
      },
      itemId: (item) => item.bond.id,
      buildMessages: (request, candidates, limit) => [
        {
          role: 'system',
          content: [
            'Select the most relevant relationship records for the current user context.',
            'Return strict JSON only.',
            'Schema: {"selectedIds":["bond-id"],"reason":"short reason","reasonById":{"bond-id":"why selected"}}',
            `Select at most ${limit} bond ids.`,
            'Only use ids from the provided candidates. Do not invent ids.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            content: request.content,
            limit,
            context: {
              actorId: request.contextRequest.actorId,
              habitatId: request.contextRequest.habitatId,
              threadId: request.contextRequest.threadId,
              projectionId: request.contextRequest.projectionId,
              targetId: request.contextRequest.targetId,
              targetType: request.contextRequest.targetType,
            },
            candidates: candidates.map(sanitizeBondCandidate),
          }),
        },
      ],
      createDefaultFallback: () => new RuleBasedBondRelevanceSelector(),
    }, eventBus, logger, options)
  }
}

export class RuleBasedBondContextProvider implements BondContextProvider {
  constructor(
    private readonly repository: BondRepository,
    private readonly eventBus?: EventBus<CoreEventMap>,
    private readonly options: RuleBasedBondContextProviderOptions = {},
  ) {}

  async buildContext(request: BondContextRequest): Promise<BondContextPack> {
    await this.eventBus?.emit('bond.context.requested', { request })

    try {
      const candidates = await this.collectCandidates(request)
      const scoredItems = candidates
        .map((bond) => this.scoreBond(bond, request))
        .filter((item) => item.score >= (this.options.minScore ?? 0.05))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return b.bond.updatedAt - a.bond.updatedAt
        })

      const selectionRequest: BondRelevanceSelectionRequest = {
        contextRequest: request,
        candidates: scoredItems,
        limit: request.limit ?? this.options.defaultLimit ?? 5,
        mode: 'ai-assisted',
        metadata: {
          ...request.metadata,
          provider: 'RuleBasedBondContextProvider',
        },
      }

      const selection = this.options.selector
        ? await this.options.selector.select(selectionRequest)
        : await new RuleBasedBondRelevanceSelector().select(selectionRequest)

      const context: BondContextPack = {
        lifeId: request.lifeId,
        actorId: request.actorId,
        habitatId: request.habitatId,
        threadId: request.threadId,
        projectionId: request.projectionId,
        mode: selection.usedAI ? 'ai-assisted' : 'rule-based',
        items: selection.items,
        totalCandidates: candidates.length,
        createdAt: Date.now(),
        metadata: {
          ...request.metadata,
          provider: 'RuleBasedBondContextProvider',
          relevanceSelectorUsedAI: selection.usedAI,
          relevanceSelectionReason: selection.reason,
          relevanceSelectionFallbackReason: selection.fallbackReason,
        },
      }

      await this.eventBus?.emit('bond.context.selected', { request, context })
      return context
    } catch (error) {
      await this.eventBus?.emit('bond.context.failed', { request, error })
      throw error
    }
  }

  private async collectCandidates(request: BondContextRequest): Promise<Bond[]> {
    const candidateLimit = this.options.candidateLimit ?? 50
    const queries: BondQuery[] = []

    const addTargetQuery = (targetId: string | undefined, targetType: BondTargetType | undefined) => {
      if (!targetId || !targetType) return
      queries.push({
        lifeId: request.lifeId,
        targetId,
        targetType,
        status: 'active',
        limit: candidateLimit,
        orderBy: 'interactionCount',
        order: 'desc',
        ...request.query,
      })
    }

    addTargetQuery(request.actorId, 'actor')
    addTargetQuery(request.threadId, 'thread')
    addTargetQuery(request.habitatId, 'habitat')
    addTargetQuery(request.projectionId, 'projection')
    addTargetQuery(request.targetId, request.targetType)

    if (queries.length === 0) {
      queries.push({
        lifeId: request.lifeId,
        status: 'active',
        limit: candidateLimit,
        orderBy: 'interactionCount',
        order: 'desc',
        ...request.query,
      })
    }

    const byId = new Map<string, Bond>()
    for (const query of queries) {
      const result = await this.repository.query(query)
      for (const bond of result.bonds) {
        byId.set(bond.id, bond)
      }
    }

    return [...byId.values()]
  }

  private scoreBond(bond: Bond, request: BondContextRequest): BondContextItem {
    const matchedBy: BondContextMatchSource[] = []
    const reasons: string[] = []
    let score = 0

    if (bond.targetType === 'actor' && bond.targetId === request.actorId) {
      score += 0.35
      matchedBy.push('actor')
      reasons.push('same actor target')
    }

    if (bond.targetType === 'thread' && bond.targetId === request.threadId) {
      score += 0.2
      matchedBy.push('thread')
      reasons.push('same thread target')
    }

    if (bond.targetType === 'habitat' && bond.targetId === request.habitatId) {
      score += 0.15
      matchedBy.push('habitat')
      reasons.push('same habitat target')
    }

    if (bond.targetType === 'projection' && bond.targetId === request.projectionId) {
      score += 0.12
      matchedBy.push('projection')
      reasons.push('same projection target')
    }

    if (request.targetId && bond.targetId === request.targetId) {
      score += 0.2
      matchedBy.push('target')
      reasons.push('explicit target match')
    }

    const positiveRelationshipScore = (
      bond.metrics.familiarity
      + bond.metrics.intimacy
      + bond.metrics.trust
      + bond.metrics.dependence * 0.5
    ) / 3.5
    const metricsScore = Math.min(0.25, positiveRelationshipScore * 0.25)
    if (metricsScore > 0.03) {
      score += metricsScore
      matchedBy.push('metrics')
      reasons.push('strong relationship metrics')
    }

    if (bond.metrics.tension >= 0.3) {
      score += Math.min(0.12, bond.metrics.tension * 0.12)
      matchedBy.push('metrics')
      reasons.push('high tension requires caution')
    }

    if ((bond.interactionCount ?? 0) > 0) {
      score += Math.min(0.08, Math.log10((bond.interactionCount ?? 0) + 1) * 0.04)
      reasons.push('interaction history')
    }

    const lastInteractionAt = bond.lastInteractionAt ?? bond.updatedAt
    const ageMs = Math.max(0, Date.now() - lastInteractionAt)
    const ageDays = ageMs / 86400000
    const recencyScore = Math.max(0, 1 - ageDays / 30) * 0.1
    if (recencyScore > 0.02) {
      score += recencyScore
      matchedBy.push('recency')
      reasons.push('recent interaction')
    }

    if (bond.summary || (bond.tags?.length ?? 0) > 0) {
      score += 0.05
      reasons.push('has relationship summary')
    }

    return {
      bond,
      score: clampUnit(score),
      reason: reasons.length > 0 ? reasons.join('; ') : 'fallback relationship relevance',
      matchedBy: [...new Set(matchedBy)],
      metadata: {
        provider: 'RuleBasedBondContextProvider',
      },
    }
  }
}

export interface MongoBondDocument {
  id: string
  bond: Bond
  createdAt: number
  updatedAt: number
}

export interface MongoBondCollection {
  findOne(filter: Record<string, unknown>): Promise<MongoBondDocument | null>
  find(filter: Record<string, unknown>): { toArray(): Promise<MongoBondDocument[]> } | Promise<MongoBondDocument[]>
  updateOne(
    filter: { id: string },
    update: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    options: { upsert: boolean },
  ): Promise<unknown>
  deleteOne?(filter: { id: string }): Promise<unknown>
  createIndex?(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown>
}

export interface MongoBondRepositoryOptions {
  collectionName?: string
  ensureIndexes?: boolean
}

export class MemoryBondRepository implements BondRepository {
  private readonly bonds = new Map<string, Bond>()

  async getById(id: string): Promise<Bond | undefined> {
    const bond = this.bonds.get(id)
    return bond ? cloneBond(bond) : undefined
  }

  async getByLifeAndTarget(
    lifeId: string,
    targetId: string,
    targetType?: BondTargetType,
  ): Promise<Bond | undefined> {
    const normalizedTargetType = targetType ? normalizeTargetType(targetType) : undefined
    const bond = [...this.bonds.values()].find((entry) => (
      entry.lifeId === lifeId
      && entry.targetId === targetId
      && entry.status !== 'deleted'
      && (normalizedTargetType === undefined || normalizeTargetType(entry.targetType) === normalizedTargetType)
    ))
    return bond ? cloneBond(bond) : undefined
  }

  async listByLife(lifeId: string, options: BondQueryOptions = {}): Promise<Bond[]> {
    const result = await this.query({
      lifeId,
      ...options,
    })
    return result.bonds
  }

  async save(bond: Bond): Promise<void> {
    this.bonds.set(bond.id, cloneBond(bond))
  }

  async update(id: string, patch: Partial<Bond>): Promise<Bond> {
    const current = this.bonds.get(id)
    if (!current) {
      throw new Error(`bond not found: ${id}`)
    }

    const updated: Bond = {
      ...current,
      ...patch,
      id: current.id,
      lifeId: current.lifeId,
      lifeInstanceId: current.lifeInstanceId,
      targetId: current.targetId,
      targetType: patch.targetType ?? current.targetType,
      metrics: patch.metrics ? { ...current.metrics, ...patch.metrics } : current.metrics,
      source: patch.source ? { ...current.source, ...patch.source } : current.source,
      metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata,
      tags: patch.tags ? [...patch.tags] : current.tags,
      updatedAt: patch.updatedAt ?? Date.now(),
    }

    this.bonds.set(id, cloneBond(updated))
    return cloneBond(updated)
  }

  async remove(id: string): Promise<void> {
    const current = this.bonds.get(id)
    if (!current) return

    this.bonds.set(id, {
      ...current,
      status: 'deleted',
      updatedAt: Date.now(),
    })
  }

  async query(query: BondQuery): Promise<BondSearchResult> {
    const targetTypes = normalizeArray(query.targetType)?.map(normalizeTargetType)
    const statuses = normalizeArray(query.status)

    const matched = [...this.bonds.values()]
      .filter((bond) => bond.lifeId === query.lifeId)
      .filter((bond) => query.includeDeleted || bond.status !== 'deleted')
      .filter((bond) => query.targetId === undefined || bond.targetId === query.targetId)
      .filter((bond) => includesAny(normalizeTargetType(bond.targetType), targetTypes))
      .filter((bond) => includesAny(bond.status, statuses))
      .filter((bond) => hasAllTags(bond.tags, query.tags))
      .filter((bond) => query.minFamiliarity === undefined || bond.metrics.familiarity >= query.minFamiliarity)
      .filter((bond) => query.minIntimacy === undefined || bond.metrics.intimacy >= query.minIntimacy)
      .filter((bond) => query.minTrust === undefined || bond.metrics.trust >= query.minTrust)
      .filter((bond) => query.minTension === undefined || bond.metrics.tension >= query.minTension)
      .filter((bond) => query.minDependence === undefined || bond.metrics.dependence >= query.minDependence)
      .filter((bond) => query.updatedAfter === undefined || bond.updatedAt >= query.updatedAfter)
      .filter((bond) => query.updatedBefore === undefined || bond.updatedAt <= query.updatedBefore)
      .sort(compareBonds(query))

    const offset = query.offset ?? 0
    const limit = query.limit ?? matched.length

    return {
      bonds: matched.slice(offset, offset + limit).map(cloneBond),
      total: matched.length,
      query,
      retrievedAt: Date.now(),
    }
  }
}


export class MongoBondRepository extends MemoryBondRepository {
  private readonly gateway: MongoDocRepository<Bond, MongoBondDocument>

  constructor(
    private readonly collection: MongoBondCollection,
    options: MongoBondRepositoryOptions = {},
  ) {
    super()
    const name = options.collectionName ?? 'elysia_bonds'
    this.gateway = new MongoDocRepository<Bond, MongoBondDocument>(collection, {
      modelKey: 'bond',
      toModel: (doc) => doc.bond,
      cloneModel: cloneBond,
      indexes: options.ensureIndexes === false ? [] : [
        { keys: { id: 1 }, options: { unique: true, name: `${name}_id_unique` } },
        { keys: { 'bond.lifeId': 1, 'bond.targetId': 1, 'bond.targetType': 1 }, options: { name: `${name}_target` } },
        { keys: { 'bond.lifeId': 1, 'bond.updatedAt': -1 }, options: { name: `${name}_life_updated` } },
      ],
    })
  }

  async ensureIndexes(): Promise<void> {
    await this.gateway.ensureIndexes()
  }

  /** 仅装入单个 id 的文档到本地 Map，供 super.update/remove 操作，避免全表加载。 */
  private async ensureLocal(id: string): Promise<void> {
    if (await super.getById(id)) return
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) await super.save(fromMongo)
  }

  /**
   * 【D1-1】按 lifeId 服务端缩小集合后，在子集上跑继承的内存过滤逻辑。
   * 取代旧的 hydrate() 全表加载：只 find({ 'bond.lifeId': lifeId })，零语义偏移。
   */
  private async scopedByLife(lifeId: string): Promise<MemoryBondRepository> {
    const bonds = await this.gateway.findMany({ 'bond.lifeId': lifeId })
    const scoped = new MemoryBondRepository()
    for (const bond of bonds) await scoped.save(bond)
    return scoped
  }

  async getById(id: string): Promise<Bond | undefined> {
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) return fromMongo
    return super.getById(id)
  }

  async getByLifeAndTarget(lifeId: string, targetId: string, targetType?: BondTargetType): Promise<Bond | undefined> {
    // 【D1-1/A-M5】filter 用嵌套字段路径 'bond.*'（文档把领域模型存于 bond 字段下），
    // 修正旧的顶层 { lifeId, targetId, targetType } 形状不匹配；不命中再按 lifeId 子集回退。
    const document = await this.collection.findOne(
      targetType === undefined
        ? { 'bond.lifeId': lifeId, 'bond.targetId': targetId }
        : { 'bond.lifeId': lifeId, 'bond.targetId': targetId, 'bond.targetType': targetType },
    )
    if (document) return cloneBond(document.bond)
    const scoped = await this.scopedByLife(lifeId)
    return scoped.getByLifeAndTarget(lifeId, targetId, targetType)
  }

  async save(bond: Bond): Promise<void> {
    await super.save(bond)
    await this.gateway.upsert(bond.id, bond)
  }

  async update(id: string, patch: Partial<Bond>): Promise<Bond> {
    await this.ensureLocal(id)
    const updated = await super.update(id, patch)
    await this.gateway.upsert(updated.id, updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.ensureLocal(id)
    await super.remove(id)
    const updated = await super.getById(id)
    if (updated) await this.gateway.upsert(updated.id, updated)
  }

  async query(query: BondQuery): Promise<BondSearchResult> {
    const scoped = await this.scopedByLife(query.lifeId)
    return scoped.query(query)
  }

  async listByLife(lifeId: string, options?: BondQueryOptions): Promise<Bond[]> {
    const scoped = await this.scopedByLife(lifeId)
    return scoped.listByLife(lifeId, options)
  }
}

export interface DefaultBondServiceOptions {
  defaultMetrics?: BondMetrics
}

export class DefaultBondService implements BondService {
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly repository: BondRepository,
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly logger?: RuntimeLogger,
    private readonly options: DefaultBondServiceOptions = {},
  ) {}

  start(): void {
    this.disposers.push(
      this.eventBus.on('behavior.bond.update.requested', async (payload) => {
        try {
          const result = await this.update({
            ...payload.request,
            source: {
              ...payload.request.source,
              behaviorPlanId: payload.planId ?? payload.request.source?.behaviorPlanId,
              executionPlanId: payload.planId ?? payload.request.source?.executionPlanId,
              executionActionId: payload.actionId ?? payload.request.source?.executionActionId,
              event: 'behavior.bond.update.requested',
            },
          })

          await this.eventBus.emit(result.created ? 'bond.created' : 'bond.updated', {
            requestId: result.requestId,
            bond: result.bond,
            result,
            planId: payload.planId,
            actionId: payload.actionId,
          })
        } catch (error) {
          await this.eventBus.emit('bond.update.failed', {
            requestId: payload.request.id,
            request: payload.request,
            error,
            planId: payload.planId,
            actionId: payload.actionId,
          })

          this.logger?.error('bond update request failed', error, {
            phase: 'bond',
            requestId: payload.request.id,
            lifeId: payload.request.lifeId,
          })
        }
      }),
    )
  }

  stop(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.()
    }
  }

  async update(request: BondUpdateRequest): Promise<BondUpdateResult> {
    const now = Date.now()
    const target = resolveTarget(request)
    const targetType = normalizeTargetType(target.targetType)
    const delta = resolveDelta(request)
    const existing = await this.repository.getByLifeAndTarget(request.lifeId, target.targetId, targetType)

    if (existing) {
      const metrics = applyDelta(existing.metrics, delta)
      const bond = await this.repository.update(existing.id, {
        metrics,
        familiarity: metrics.familiarity,
        intimacy: metrics.intimacy,
        trust: metrics.trust,
        summary: request.summary ?? existing.summary,
        tags: mergeTags(existing.tags, request.tags),
        actorId: request.actorId ?? existing.actorId,
        habitatId: request.habitatId ?? existing.habitatId,
        threadId: request.threadId ?? existing.threadId,
        projectionId: request.projectionId ?? existing.projectionId,
        source: {
          ...existing.source,
          ...request.source,
          stimulusId: request.stimulusId ?? request.source?.stimulusId ?? existing.source?.stimulusId,
        },
        updatedAt: now,
        lastInteractionAt: now,
        interactionCount: (existing.interactionCount ?? 0) + 1,
        metadata: {
          ...existing.metadata,
          ...request.metadata,
          lastBondUpdateRequestId: request.id,
          lastInteractionType: request.interactionType,
          lastSentiment: request.sentiment,
        },
      })

      return {
        requestId: request.id,
        bond,
        created: false,
        updated: true,
        delta,
        reason: 'updated-existing-bond',
      }
    }

    const baseMetrics = this.options.defaultMetrics ?? {
      familiarity: 0.1,
      intimacy: 0.05,
      trust: 0.1,
      tension: 0,
      dependence: 0,
    }
    const metrics = applyDelta(baseMetrics, delta)
    const bond: Bond = {
      id: request.metadata?.bondId && typeof request.metadata.bondId === 'string'
        ? request.metadata.bondId
        : nextBondId(),
      lifeId: request.lifeId,
      lifeInstanceId: request.lifeId,
      targetId: target.targetId,
      targetType,
      status: 'active',
      metrics,
      familiarity: metrics.familiarity,
      intimacy: metrics.intimacy,
      trust: metrics.trust,
      summary: request.summary,
      tags: normalizeTags(request.tags),
      actorId: request.actorId,
      habitatId: request.habitatId,
      threadId: request.threadId,
      projectionId: request.projectionId,
      source: {
        ...request.source,
        stimulusId: request.stimulusId ?? request.source?.stimulusId,
      },
      createdAt: request.createdAt ?? now,
      updatedAt: now,
      lastInteractionAt: now,
      interactionCount: 1,
      metadata: {
        ...request.metadata,
        bondUpdateRequestId: request.id,
        interactionType: request.interactionType,
        sentiment: request.sentiment,
      },
    }

    await this.repository.save(bond)

    return {
      requestId: request.id,
      bond,
      created: true,
      updated: false,
      delta,
      reason: 'created-new-bond',
    }
  }

  async retrieve(query: BondQuery): Promise<BondSearchResult> {
    try {
      const result = await this.repository.query(query)
      await this.eventBus.emit('bond.retrieved', {
        query,
        result,
      })
      return result
    } catch (error) {
      await this.eventBus.emit('bond.retrieve.failed', {
        query,
        error,
      })
      throw error
    }
  }
}

function resolveTarget(request: BondUpdateRequest): { targetId: string; targetType: BondTargetType } {
  if (request.targetId) {
    return {
      targetId: request.targetId,
      targetType: request.targetType ?? 'actor',
    }
  }

  if (request.actorId) {
    return {
      targetId: request.actorId,
      targetType: 'actor',
    }
  }

  if (request.habitatId) {
    return {
      targetId: request.habitatId,
      targetType: 'habitat',
    }
  }

  if (request.threadId) {
    return {
      targetId: request.threadId,
      targetType: 'thread',
    }
  }

  return {
    targetId: request.lifeId,
    targetType: 'life',
  }
}

function resolveDelta(request: BondUpdateRequest): Partial<BondMetrics> {
  if (request.delta) {
    return sanitizeDelta(request.delta)
  }

  const suggestion = clampUnitOr(request.deltaSuggestion, 0.5)
  const scale = 0.5 + suggestion
  const sentiment = request.sentiment

  if (sentiment === 'negative') {
    return sanitizeDelta({
      familiarity: 0.01 * scale,
      trust: -0.02 * scale,
      tension: 0.03 * scale,
    })
  }

  if (sentiment === 'positive') {
    return sanitizeDelta({
      familiarity: 0.03 * scale,
      intimacy: 0.02 * scale,
      trust: 0.02 * scale,
      tension: -0.02 * scale,
    })
  }

  const interactionBonus = request.interactionType ? 0.01 * scale : 0
  return sanitizeDelta({
    familiarity: 0.01 * scale + interactionBonus,
    trust: 0.005 * scale,
  })
}

function sanitizeDelta(delta: Partial<BondMetrics>): Partial<BondMetrics> {
  return {
    familiarity: normalizeDeltaValue(delta.familiarity),
    intimacy: normalizeDeltaValue(delta.intimacy),
    trust: normalizeDeltaValue(delta.trust),
    tension: normalizeDeltaValue(delta.tension),
    dependence: normalizeDeltaValue(delta.dependence),
  }
}

function normalizeDeltaValue(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  return value
}

function applyDelta(metrics: BondMetrics, delta: Partial<BondMetrics>): BondMetrics {
  return {
    familiarity: clampUnitOr(metrics.familiarity + (delta.familiarity ?? 0), metrics.familiarity),
    intimacy: clampUnitOr(metrics.intimacy + (delta.intimacy ?? 0), metrics.intimacy),
    trust: clampUnitOr(metrics.trust + (delta.trust ?? 0), metrics.trust),
    tension: clampUnitOr(metrics.tension + (delta.tension ?? 0), metrics.tension),
    dependence: clampUnitOr(metrics.dependence + (delta.dependence ?? 0), metrics.dependence),
  }
}


export function createBondPluginRuntime(options: BondPluginRuntimeOptions): BondPluginRuntime | undefined {
  const { runtime, config, logger } = options

  logger.info('bond plugin apply started', {
    plugin: 'elysia-ai-bond',
    phase: 'apply',
  })

  if (config.enabled === false) {
    logger.info('bond plugin disabled by config', {
      plugin: 'elysia-ai-bond',
      phase: 'apply',
    })
    return undefined
  }

  const repository = options.repository ?? options.repositoryFactory?.({ config, logger }) ?? new MemoryBondRepository()
  const repositoryType = config.repository?.type ?? 'memory'
  void runtime.context.eventBus.emit('repository.initialized', {
    component: 'bond',
    repositoryType,
    collectionName: config.repository?.mongo?.collectionName,
    metadata: {
      plugin: 'elysia-ai-bond',
      provider: repository.constructor.name,
    },
  })

  if (repositoryType === 'memory' && !options.repository && !options.repositoryFactory) {
    void runtime.context.eventBus.emit('repository.fallback-to-memory', {
      component: 'bond',
      repositoryType,
      reason: 'default-in-memory-repository',
      metadata: { plugin: 'elysia-ai-bond' },
    })
  }

  const relevanceSelector = new RuleBasedBondRelevanceSelector()
  const service = new DefaultBondService(
    repository,
    runtime.context.eventBus,
    logger,
  )
  const contextProvider = new RuleBasedBondContextProvider(
    repository,
    runtime.context.eventBus,
    {
      defaultLimit: config.contextLimit,
      selector: relevanceSelector,
    },
  )
  const bondPluginService: BondPluginService = {
    repository,
    service,
    contextProvider,
    relevanceSelector,
  }

  service.start?.()

  logger.info('bond plugin ready', {
    plugin: 'elysia-ai-bond',
    phase: 'apply',
    contextLimit: config.contextLimit,
    repositoryType: config.repository?.type ?? 'memory',
  })

  return {
    service: bondPluginService,
    repository,
    bondService: service,
    contextProvider,
    dispose() {
      service.stop?.()
      logger.info('bond plugin disposed', {
        plugin: 'elysia-ai-bond',
        phase: 'dispose',
      })
    },
  }
}
