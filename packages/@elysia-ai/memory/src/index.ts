import type {
  BrainService,
  CoreEventMap,
  EventBus,
  MemoryAttributionMode,
  MemoryAttributionResult,
  MemoryAttributor,
  MemoryConsolidationRequest,
  MemoryConsolidationResult,
  MemoryContextItem,
  MemoryContextMatchSource,
  MemoryContextPack,
  MemoryContextProvider,
  MemoryContextRequest,
  MemoryEntry,
  MemoryKind,
  MemoryOwnerType,
  MemoryQuery,
  MemoryQueryOptions,
  MemoryRelation,
  MemoryRelevanceSelectionRequest,
  MemoryRelevanceSelectionResult,
  MemoryRelevanceSelector,
  MemoryRepository,
  MemoryScope,
  MemorySearchResult,
  MemoryService,
  MemoryUpdateRequest,
  MemoryUpdateResult,
  MemoryVisibility,
} from '@elysia-ai/core'
import {
  AiAssistedRelevanceSelectorBase,
  MongoDocRepository,
  clampUnit,
  clampUnitOr,
} from '@elysia-ai/shared'
import type { MongoFindOptions } from '@elysia-ai/shared'


export const internalName = 'elysia-ai-memory'

export interface RuntimeLogger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface MemoryPluginService {
  repository: MemoryRepository
  service: MemoryService
  attributor: MemoryAttributor
  contextProvider: MemoryContextProvider
  relevanceSelector: MemoryRelevanceSelector
}

export interface MemoryRepositoryConfig {
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
  maxEntriesPerLife?: number
  contextLimit: number
}

export interface MemoryRepositoryFactoryOptions {
  config: Config
  logger: RuntimeLogger
}

export interface MemoryPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> } }
  config: Config
  logger: RuntimeLogger
  repository?: MemoryRepository
  repositoryFactory?: (options: MemoryRepositoryFactoryOptions) => MemoryRepository
}

export interface MemoryPluginRuntime {
  service: MemoryPluginService
  repository: MemoryRepository
  memoryService: MemoryService
  contextProvider: MemoryContextProvider
  dispose(): void
}

let memoryCounter = 0

function nextMemoryId(prefix = 'memory'): string {
  memoryCounter += 1
  return `${prefix}-${Date.now()}-${memoryCounter}`
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

function textMatches(entry: MemoryEntry, text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return true
  const needle = text.toLowerCase()
  return [
    entry.content,
    entry.summary,
    ...(entry.tags ?? []),
  ].some((value) => value?.toLowerCase().includes(needle))
}

function tokenizeText(text: string | undefined): string[] {
  if (!text) return []
  return [...new Set(text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))]
}

function relationMatches(entry: MemoryEntry, query: MemoryQuery): boolean {
  if (!query.relationTargetType && !query.relationTargetId && !query.relationRole) return true
  return (entry.relations ?? []).some((relation) => (
    (query.relationTargetType === undefined || relation.targetType === query.relationTargetType)
    && (query.relationTargetId === undefined || relation.targetId === query.relationTargetId)
    && (query.relationRole === undefined || relation.role === query.relationRole)
  ))
}

function cloneRelation(relation: MemoryRelation): MemoryRelation {
  return {
    ...relation,
    metadata: relation.metadata ? { ...relation.metadata } : undefined,
  }
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    tags: entry.tags ? [...entry.tags] : undefined,
    relations: entry.relations ? entry.relations.map(cloneRelation) : undefined,
    source: entry.source ? { ...entry.source } : undefined,
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
  }
}

function compareEntries(query: MemoryQuery): (a: MemoryEntry, b: MemoryEntry) => number {
  const orderBy = query.orderBy ?? 'createdAt'
  const direction = query.order === 'asc' ? 1 : -1

  return (a, b) => {
    const left = a[orderBy] ?? 0
    const right = b[orderBy] ?? 0
    if (left === right) return b.createdAt - a.createdAt
    return (left - right) * direction
  }
}

function relationKey(relation: MemoryRelation): string {
  return `${relation.targetType}:${relation.targetId}:${relation.role}`
}

function mergeRelations(left: MemoryRelation[] | undefined, right: MemoryRelation[] | undefined): MemoryRelation[] | undefined {
  const merged = new Map<string, MemoryRelation>()

  for (const relation of [...(left ?? []), ...(right ?? [])]) {
    const key = relationKey(relation)
    const current = merged.get(key)
    merged.set(key, {
      ...current,
      ...relation,
      confidence: Math.max(current?.confidence ?? 0, relation.confidence ?? 0),
      metadata: {
        ...current?.metadata,
        ...relation.metadata,
      },
    })
  }

  const relations = [...merged.values()].map(cloneRelation)
  return relations.length > 0 ? relations : undefined
}

function isNewsMemoryRequest(request: MemoryUpdateRequest): boolean {
  return request.eventType === 'news'
    || request.metadata?.memoryCategory === 'news'
    || request.metadata?.eventType === 'news'
}

function isGlobalMemoryRequest(request: MemoryUpdateRequest): boolean {
  return request.ownerType === 'global'
    || request.scope === 'global'
    || request.visibility === 'global'
    || isNewsMemoryRequest(request)
}

function inferOwnerType(request: MemoryUpdateRequest): MemoryOwnerType {
  if (request.ownerType) return request.ownerType
  if (isGlobalMemoryRequest(request)) return 'global'
  if (request.eventId) return 'event'
  if (request.threadId) return 'thread'
  if (request.habitatId) return 'habitat'
  if (request.actorId) return 'actor'
  if (request.projectionId) return 'projection'
  return 'life'
}

function inferOwnerId(request: MemoryUpdateRequest, ownerType: MemoryOwnerType): string {
  if (request.ownerId) return request.ownerId

  switch (ownerType) {
    case 'actor':
      return request.actorId ?? request.lifeId
    case 'habitat':
      return request.habitatId ?? request.lifeId
    case 'thread':
      return request.threadId ?? request.lifeId
    case 'projection':
      return request.projectionId ?? request.lifeId
    case 'event':
      return request.eventId ?? request.threadId ?? request.stimulusId ?? request.id
    case 'global':
      return 'global'
    case 'life':
    default:
      return request.lifeId
  }
}

function inferVisibility(request: MemoryUpdateRequest, ownerType: MemoryOwnerType): MemoryVisibility {
  if (request.visibility) return request.visibility

  switch (ownerType) {
    case 'actor':
      return 'private'
    case 'habitat':
      return 'habitat'
    case 'thread':
    case 'event':
      return request.habitatId ? 'shared' : 'private'
    case 'global':
      return 'global'
    default:
      return 'private'
  }
}

function inferRelations(request: MemoryUpdateRequest, ownerType: MemoryOwnerType, ownerId: string): MemoryRelation[] {
  const relations = new Map<string, MemoryRelation>()

  const add = (relation: MemoryRelation | undefined) => {
    if (!relation?.targetId) return
    relations.set(relationKey(relation), relation)
  }

  for (const relation of request.relations ?? []) add(relation)

  add({
    targetType: ownerType,
    targetId: ownerId,
    role: 'subject',
    confidence: 1,
  })

  if (request.actorId) {
    add({
      targetType: 'actor',
      targetId: request.actorId,
      role: ownerType === 'actor' ? 'subject' : 'participant',
      confidence: 1,
    })
  }

  if (request.habitatId) {
    add({
      targetType: 'habitat',
      targetId: request.habitatId,
      role: 'location',
      confidence: 1,
    })
  }

  if (request.threadId) {
    add({
      targetType: 'thread',
      targetId: request.threadId,
      role: ownerType === 'thread' ? 'subject' : 'source',
      confidence: 1,
    })
  }

  if (request.projectionId) {
    add({
      targetType: 'projection',
      targetId: request.projectionId,
      role: 'observer',
      confidence: 1,
    })
  }

  if (request.eventId) {
    add({
      targetType: 'event',
      targetId: request.eventId,
      role: ownerType === 'event' ? 'subject' : 'source',
      confidence: 1,
    })
  }

  return [...relations.values()].map(cloneRelation)
}

function applyDeterministicAttribution(request: MemoryUpdateRequest): MemoryUpdateRequest {
  const ownerType = inferOwnerType(request)
  const ownerId = inferOwnerId(request, ownerType)
  const visibility = inferVisibility(request, ownerType)
  const relations = inferRelations(request, ownerType, ownerId)
  const eventType = request.eventType ?? (isNewsMemoryRequest(request) ? 'news' : undefined)

  return {
    ...request,
    ownerType,
    ownerId,
    visibility,
    relations,
    eventId: request.eventId ?? (ownerType === 'event' ? ownerId : undefined),
    eventType,
    scope: request.scope ?? ownerTypeToScope(ownerType),
    kind: request.kind ?? (eventType === 'news' ? 'semantic' : undefined),
    attributionMode: request.attributionMode ?? 'deterministic',
    metadata: {
      ...request.metadata,
      attributionMode: request.attributionMode ?? 'deterministic',
      attributionReason: 'deterministic-owner-routing',
    },
  }
}

function ownerTypeToScope(ownerType: MemoryOwnerType): MemoryScope {
  switch (ownerType) {
    case 'actor':
      return 'actor'
    case 'habitat':
      return 'habitat'
    case 'thread':
    case 'event':
      return 'thread'
    case 'projection':
      return 'projection'
    case 'global':
      return 'global'
    case 'life':
    default:
      return 'life'
  }
}

export class DeterministicMemoryAttributor implements MemoryAttributor {
  async attribute(request: MemoryUpdateRequest): Promise<MemoryAttributionResult> {
    return {
      mode: 'deterministic',
      requests: [applyDeterministicAttribution(request)],
      diagnostics: {
        reason: 'deterministic-owner-routing',
        usedAI: false,
      },
    }
  }
}

export interface RuleBasedMemoryContextProviderOptions {
  candidateLimit?: number
  defaultLimit?: number
  minScore?: number
  selector?: MemoryRelevanceSelector
}

export class RuleBasedMemoryRelevanceSelector implements MemoryRelevanceSelector {
  async select(request: MemoryRelevanceSelectionRequest): Promise<MemoryRelevanceSelectionResult> {
    const limit = request.limit ?? request.contextRequest.limit ?? 5
    const items = [...request.candidates]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return b.entry.createdAt - a.entry.createdAt
      })
      .slice(0, limit)
    const selectedIds = items.map((item) => item.entry.id)
    const selectedSet = new Set(selectedIds)

    return {
      items,
      selectedIds,
      rejectedIds: request.candidates
        .filter((item) => !selectedSet.has(item.entry.id))
        .map((item) => item.entry.id),
      reason: 'rule-based-score-ranking',
      usedAI: false,
      metadata: {
        selector: 'RuleBasedMemoryRelevanceSelector',
      },
    }
  }
}

export interface AiAssistedMemoryRelevanceSelectorOptions {
  maxCandidates?: number
  defaultLimit?: number
  fallbackSelector?: MemoryRelevanceSelector
  timeoutMs?: number
}

function sanitizeMemoryCandidate(item: MemoryContextItem): Record<string, unknown> {
  return {
    id: item.entry.id,
    kind: item.entry.kind,
    scope: item.entry.scope,
    ownerType: item.entry.ownerType,
    ownerId: item.entry.ownerId,
    visibility: item.entry.visibility,
    content: item.entry.summary ?? item.entry.content,
    tags: item.entry.tags,
    score: item.score,
    reason: item.reason,
    matchedBy: item.matchedBy,
  }
}

export class AiAssistedMemoryRelevanceSelector
  extends AiAssistedRelevanceSelectorBase<MemoryContextItem, MemoryRelevanceSelectionRequest, MemoryRelevanceSelectionResult>
  implements MemoryRelevanceSelector {
  constructor(
    brainService: BrainService | undefined,
    eventBus?: EventBus<CoreEventMap>,
    logger?: RuntimeLogger,
    options: AiAssistedMemoryRelevanceSelectorOptions = {},
  ) {
    super(brainService, {
      selectorName: 'AiAssistedMemoryRelevanceSelector',
      task: 'memory-relevance-selection',
      logPhase: 'memory-relevance-selection',
      label: 'memory relevance selection',
      events: {
        requested: 'memory.relevance.selection.requested',
        completed: 'memory.relevance.selection.completed',
        failed: 'memory.relevance.selection.failed',
        fallback: 'memory.relevance.selection.fallback',
      },
      itemId: (item) => item.entry.id,
      buildMessages: (request, candidates, limit) => [
        {
          role: 'system',
          content: [
            'Select the most relevant long-term memories for the current user context.',
            'Return strict JSON only.',
            'Schema: {"selectedIds":["memory-id"],"reason":"short reason","reasonById":{"memory-id":"why selected"}}',
            `Select at most ${limit} memory ids.`,
            'Only use ids from the provided candidates. Do not invent ids.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            content: request.content ?? request.contextRequest.content,
            limit,
            candidates: candidates.map(sanitizeMemoryCandidate),
          }),
        },
      ],
      createDefaultFallback: () => new RuleBasedMemoryRelevanceSelector(),
    }, eventBus, logger, options)
  }
}

export class RuleBasedMemoryContextProvider implements MemoryContextProvider {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly eventBus?: EventBus<CoreEventMap>,
    private readonly options: RuleBasedMemoryContextProviderOptions = {},
  ) {}

  async buildContext(request: MemoryContextRequest): Promise<MemoryContextPack> {
    await this.eventBus?.emit('memory.context.requested', { request })

    try {
      const candidates = await this.collectCandidates(request)
      const scoredItems = candidates
        .map((entry) => this.scoreEntry(entry, request))
        .filter((item) => item.score >= (this.options.minScore ?? 0.05))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return b.entry.createdAt - a.entry.createdAt
        })

      const selectionRequest: MemoryRelevanceSelectionRequest = {
        contextRequest: request,
        candidates: scoredItems,
        content: request.content,
        limit: request.limit ?? this.options.defaultLimit ?? 5,
        mode: 'ai-assisted',
        metadata: {
          ...request.metadata,
          provider: 'RuleBasedMemoryContextProvider',
        },
      }

      const selection = this.options.selector
        ? await this.options.selector.select(selectionRequest)
        : await new RuleBasedMemoryRelevanceSelector().select(selectionRequest)

      const context: MemoryContextPack = {
        lifeId: request.lifeId,
        stimulusId: request.stimulusId,
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
          provider: 'RuleBasedMemoryContextProvider',
          relevanceSelectorUsedAI: selection.usedAI,
          relevanceSelectionReason: selection.reason,
          relevanceSelectionFallbackReason: selection.fallbackReason,
        },
      }

      await this.eventBus?.emit('memory.context.selected', { request, context })
      return context
    } catch (error) {
      await this.eventBus?.emit('memory.context.failed', { request, error })
      throw error
    }
  }

  private async collectCandidates(request: MemoryContextRequest): Promise<MemoryEntry[]> {
    const candidateLimit = this.options.candidateLimit ?? 50
    const queries: MemoryQuery[] = []

    if (request.actorId) {
      queries.push({
        lifeId: request.lifeId,
        ownerType: 'actor',
        ownerId: request.actorId,
        visibility: 'private',
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (request.threadId) {
      queries.push({
        lifeId: request.lifeId,
        ownerType: 'thread',
        ownerId: request.threadId,
        visibility: ['shared', 'private'],
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (request.includeHabitat !== false && request.habitatId) {
      queries.push({
        lifeId: request.lifeId,
        ownerType: 'habitat',
        ownerId: request.habitatId,
        visibility: ['habitat', 'shared'],
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (request.includeGlobal !== false) {
      queries.push({
        lifeId: request.lifeId,
        ownerType: 'global',
        visibility: 'global',
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (request.actorId) {
      queries.push({
        lifeId: request.lifeId,
        relationTargetType: 'actor',
        relationTargetId: request.actorId,
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (request.content && request.content.trim().length > 0) {
      queries.push({
        lifeId: request.lifeId,
        text: request.content,
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    if (queries.length === 0) {
      queries.push({
        lifeId: request.lifeId,
        status: 'active',
        limit: candidateLimit,
        orderBy: 'importance',
        order: 'desc',
        ...request.query,
      })
    }

    const byId = new Map<string, MemoryEntry>()
    for (const query of queries) {
      const result = await this.repository.query(query)
      for (const entry of result.entries) {
        if (this.isVisibleToRequest(entry, request)) {
          byId.set(entry.id, entry)
        }
      }
    }

    return [...byId.values()]
  }

  private isVisibleToRequest(entry: MemoryEntry, request: MemoryContextRequest): boolean {
    if (entry.visibility === 'global') return true
    if (entry.visibility === 'habitat') return !entry.habitatId || entry.habitatId === request.habitatId
    if (entry.visibility === 'shared') {
      // W3：线程限定的 shared 记忆不泄漏到 habitat 级请求——
      // 请求未带 threadId 时不可见（此前会落到 habitat 匹配或直接放行）。
      if (entry.threadId) return !!request.threadId && entry.threadId === request.threadId
      if (entry.habitatId && request.habitatId) return entry.habitatId === request.habitatId
      return true
    }
    if (entry.visibility === 'private') {
      if (entry.ownerType === 'actor') return entry.ownerId === request.actorId
      if (entry.actorId) return entry.actorId === request.actorId
    }
    return entry.visibility === undefined
  }

  private scoreEntry(entry: MemoryEntry, request: MemoryContextRequest): MemoryContextItem {
    const matchedBy: MemoryContextMatchSource[] = []
    const reasons: string[] = []
    let score = 0

    score += entry.importance * 0.35
    if (entry.importance >= 0.7) {
      matchedBy.push('importance')
      reasons.push('high importance')
    }

    if (entry.ownerType === 'actor' && entry.ownerId === request.actorId) {
      score += 0.25
      matchedBy.push('actor')
      reasons.push('same actor owner')
    }

    if (entry.ownerType === 'thread' && entry.ownerId === request.threadId) {
      score += 0.2
      matchedBy.push('thread')
      reasons.push('same thread owner')
    }

    if (entry.ownerType === 'habitat' && entry.ownerId === request.habitatId) {
      score += 0.15
      matchedBy.push('habitat')
      reasons.push('same habitat owner')
    }

    if (entry.ownerType === 'global' || entry.visibility === 'global') {
      score += 0.08
      matchedBy.push('global')
      reasons.push('global memory')
    }

    const relationMatched = (entry.relations ?? []).some((relation) => (
      (request.actorId && relation.targetType === 'actor' && relation.targetId === request.actorId)
      || (request.habitatId && relation.targetType === 'habitat' && relation.targetId === request.habitatId)
      || (request.threadId && relation.targetType === 'thread' && relation.targetId === request.threadId)
    ))

    if (relationMatched) {
      score += 0.15
      matchedBy.push('relation')
      reasons.push('related entity match')
    }

    const contentTokens = tokenizeText(request.content)
    const memoryText = [
      entry.content,
      entry.summary,
      ...(entry.tags ?? []),
    ].join(' ').toLowerCase()
    const matchedTokenCount = contentTokens.filter((token) => memoryText.includes(token)).length

    if (matchedTokenCount > 0) {
      score += Math.min(0.2, matchedTokenCount * 0.04)
      matchedBy.push('text')
      reasons.push(`text overlap ${matchedTokenCount}`)
    }

    const ageMs = Math.max(0, Date.now() - entry.createdAt)
    const ageDays = ageMs / 86400000
    const recencyScore = Math.max(0, 1 - ageDays / 30) * 0.07
    if (recencyScore > 0.02) {
      score += recencyScore
      matchedBy.push('recency')
      reasons.push('recent memory')
    }

    return {
      entry,
      score: clampUnit(score),
      reason: reasons.length > 0 ? reasons.join('; ') : 'fallback relevance',
      matchedBy: [...new Set(matchedBy)],
      metadata: {
        provider: 'RuleBasedMemoryContextProvider',
      },
    }
  }
}

export interface MongoMemoryDocument {
  entry: MemoryEntry
}

export interface MongoMemoryCollection {
  findOne(filter: Record<string, unknown>): Promise<MongoMemoryDocument | null>
  find(
    filter: Record<string, unknown>,
    options?: MongoFindOptions,
  ): { toArray(): Promise<MongoMemoryDocument[]> } | Promise<MongoMemoryDocument[]>
  /** 服务端计数（可选：fake/内存驱动可缺省，gateway.count 回退 findMany 计数）。 */
  countDocuments?(filter: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    options: { upsert: boolean },
  ): Promise<unknown>
  deleteOne?(filter: Record<string, unknown>): Promise<unknown>
  createIndex?(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown>
}

export interface MongoMemoryRepositoryOptions {
  collectionName?: string
  ensureIndexes?: boolean
}

export class MemoryMemoryRepository implements MemoryRepository {
  private readonly entries = new Map<string, MemoryEntry>()

  async getById(id: string): Promise<MemoryEntry | undefined> {
    const entry = this.entries.get(id)
    return entry ? cloneEntry(entry) : undefined
  }

  async save(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, cloneEntry(entry))
  }

  async update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const current = this.entries.get(id)
    if (!current) {
      throw new Error(`memory entry not found: ${id}`)
    }

    const updated: MemoryEntry = {
      ...current,
      ...patch,
      id: current.id,
      lifeId: current.lifeId,
      source: patch.source ? { ...current.source, ...patch.source } : current.source,
      metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata,
      tags: patch.tags ? [...patch.tags] : current.tags,
      relations: patch.relations ? patch.relations.map(cloneRelation) : current.relations,
      updatedAt: patch.updatedAt ?? Date.now(),
    }

    this.entries.set(id, cloneEntry(updated))
    return cloneEntry(updated)
  }

  /** 从本地 Map 硬逐出（区别于软删除的 remove）；供 Mongo 子类控制本地副本规模。 */
  evictLocal(id: string): void {
    this.entries.delete(id)
  }

  async remove(id: string): Promise<void> {
    const current = this.entries.get(id)
    if (!current) return

    this.entries.set(id, {
      ...current,
      status: 'deleted',
      updatedAt: Date.now(),
    })
  }

  async query(query: MemoryQuery): Promise<MemorySearchResult> {
    const scopes = normalizeArray(query.scope)
    const kinds = normalizeArray(query.kind)
    const statuses = normalizeArray(query.status)
    const ownerTypes = normalizeArray(query.ownerType)
    const visibilities = normalizeArray(query.visibility)

    const matched = [...this.entries.values()]
      .filter((entry) => entry.lifeId === query.lifeId)
      .filter((entry) => query.includeDeleted || entry.status !== 'deleted')
      .filter((entry) => query.actorId === undefined || entry.actorId === query.actorId)
      .filter((entry) => query.habitatId === undefined || entry.habitatId === query.habitatId)
      .filter((entry) => query.threadId === undefined || entry.threadId === query.threadId)
      .filter((entry) => query.projectionId === undefined || entry.projectionId === query.projectionId)
      .filter((entry) => query.stimulusId === undefined || entry.source?.stimulusId === query.stimulusId)
      .filter((entry) => includesAny(entry.scope, scopes))
      .filter((entry) => includesAny(entry.kind, kinds))
      .filter((entry) => includesAny(entry.status, statuses))
      .filter((entry) => includesAny(entry.ownerType, ownerTypes))
      .filter((entry) => query.ownerId === undefined || entry.ownerId === query.ownerId)
      .filter((entry) => includesAny(entry.visibility, visibilities))
      .filter((entry) => query.eventId === undefined || entry.eventId === query.eventId)
      .filter((entry) => query.eventType === undefined || entry.eventType === query.eventType)
      .filter((entry) => relationMatches(entry, query))
      .filter((entry) => hasAllTags(entry.tags, query.tags))
      .filter((entry) => textMatches(entry, query.text))
      .filter((entry) => query.minImportance === undefined || entry.importance >= query.minImportance)
      .filter((entry) => query.minConfidence === undefined || entry.confidence >= query.minConfidence)
      .filter((entry) => query.createdAfter === undefined || entry.createdAt >= query.createdAfter)
      .filter((entry) => query.createdBefore === undefined || entry.createdAt <= query.createdBefore)
      .sort(compareEntries(query))

    const offset = query.offset ?? 0
    const limit = query.limit ?? matched.length
    const entries = matched.slice(offset, offset + limit).map(cloneEntry)

    return {
      entries,
      total: matched.length,
      query,
      retrievedAt: Date.now(),
    }
  }

  async listByLifeId(lifeId: string, options: MemoryQueryOptions = {}): Promise<MemoryEntry[]> {
    const result = await this.query({
      lifeId,
      ...options,
    })
    return result.entries
  }

  async listByStimulusId(stimulusId: string): Promise<MemoryEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.source?.stimulusId === stimulusId)
      .filter((entry) => entry.status !== 'deleted')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(cloneEntry)
  }

  /**
   * 【B3】enforceMaxEntries 计数化能力（内存版）：过滤计数 + (importance asc, createdAt asc) 溢出集。
   * 与服务层旧路径语义一致：只统计/淘汰 active 记忆，archived 不占上限（P0-4）。
   */
  async countActiveByLife(lifeId: string): Promise<number> {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.lifeId === lifeId && entry.status === 'active') count += 1
    }
    return count
  }

  async listOverflowingActiveByLife(lifeId: string, limit: number): Promise<MemoryEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.lifeId === lifeId && entry.status === 'active')
      .sort((a, b) => {
        const importance = a.importance - b.importance
        if (importance !== 0) return importance
        return a.createdAt - b.createdAt
      })
      .slice(0, limit)
      .map(cloneEntry)
  }
}


/**
 * 【B3】enforceMaxEntries 的计数化能力（可选能力，服务层鸭子类型探测）：
 * Mongo 走 countDocuments + 溢出集服务端直查；内存仓储走过滤计数。
 * 未实现该能力的第三方仓储自动回退旧的 listByLifeId 窗口拉取路径。
 */
export interface MemoryEntryCapacityRepository {
  /** lifeId 下 active 记忆总数。 */
  countActiveByLife(lifeId: string): Promise<number>
  /** (importance asc, createdAt asc) 序的前 limit 条 active 记忆（上限溢出集）。 */
  listOverflowingActiveByLife(lifeId: string, limit: number): Promise<MemoryEntry[]>
}


/**
 * 【D1-2】支持原子访问计数的仓储能力（Mongo 实现）。
 * service 层用鸭子类型探测此能力：存在则走服务端 $inc，否则退回读-改-写。
 */
export interface AtomicAccessRepository {
  incrementAccess(id: string, now: number): Promise<MemoryEntry | undefined>
}

/** 非空数组归一（空数组在 includesAny 语义下等于无约束）。 */
function nonEmptyArray<T>(value: T[] | undefined): T[] | undefined {
  return value && value.length > 0 ? value : undefined
}

/**
 * 【B2】MemoryQuery → Mongo filter 下推映射。
 * 只下推可精确表达的维度（等值 / $in / $gte / $lte / $elemMatch）：
 * - text 子串匹配与 tags 大小写不敏感 ALL 语义无法精确下推（$in 是大小写敏感的
 *   "任一命中"，会把 'Prod' 排除在 ['prod'] 之外），留在内存精滤（见 query()）；
 * - status：includeDeleted 时不加状态键；否则默认排除 deleted，指定时按 $in
 *   （与内存版 includesAny 语义一致；statuses 含 deleted 时叠加 $ne）。
 */
function buildMemoryFilter(query: MemoryQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = { 'entry.lifeId': query.lifeId }

  const statuses = nonEmptyArray(normalizeArray(query.status))
  if (!query.includeDeleted) {
    filter['entry.status'] = statuses
      ? (statuses.includes('deleted') ? { $in: statuses, $ne: 'deleted' } : { $in: statuses })
      : { $ne: 'deleted' }
  } else if (statuses) {
    filter['entry.status'] = { $in: statuses }
  }

  const equalities: Array<[keyof MemoryQuery, string]> = [
    ['actorId', 'entry.actorId'],
    ['habitatId', 'entry.habitatId'],
    ['threadId', 'entry.threadId'],
    ['projectionId', 'entry.projectionId'],
    ['ownerId', 'entry.ownerId'],
    ['eventId', 'entry.eventId'],
    ['eventType', 'entry.eventType'],
    ['stimulusId', 'entry.source.stimulusId'],
  ]
  for (const [queryKey, filterKey] of equalities) {
    const value = query[queryKey]
    if (value !== undefined) filter[filterKey] = value
  }

  const inclusions: Array<[keyof MemoryQuery, string]> = [
    ['scope', 'entry.scope'],
    ['kind', 'entry.kind'],
    ['ownerType', 'entry.ownerType'],
    ['visibility', 'entry.visibility'],
  ]
  for (const [queryKey, filterKey] of inclusions) {
    const values = nonEmptyArray(normalizeArray(query[queryKey] as string | string[] | undefined))
    if (values) filter[filterKey] = { $in: values }
  }

  if (query.minImportance !== undefined) filter['entry.importance'] = { $gte: query.minImportance }
  if (query.minConfidence !== undefined) filter['entry.confidence'] = { $gte: query.minConfidence }
  if (query.createdAfter !== undefined) filter['entry.createdAt'] = { $gte: query.createdAfter }
  if (query.createdBefore !== undefined) {
    filter['entry.createdAt'] = { ...(filter['entry.createdAt'] as object), $lte: query.createdBefore }
  }

    if (query.relationTargetType !== undefined
      || query.relationTargetId !== undefined
      || query.relationRole !== undefined) {
      const elemMatch: Record<string, unknown> = {}
      if (query.relationTargetType !== undefined) elemMatch.targetType = query.relationTargetType
      if (query.relationTargetId !== undefined) elemMatch.targetId = query.relationTargetId
      if (query.relationRole !== undefined) elemMatch.role = query.relationRole
      filter['entry.relations'] = { $elemMatch: elemMatch }
    }

  return filter
}

/**
 * 【B2】MemoryQuery 排序 → Mongo sort：orderBy（默认 createdAt）+ asc/desc；
 * 并列键固定 createdAt 倒序（对齐内存比较器的 tie-break `b.createdAt - a.createdAt`）。
 */
function buildMemorySort(query: MemoryQuery): Record<string, 1 | -1> {
  const orderBy = query.orderBy ?? 'createdAt'
  const direction: 1 | -1 = query.order === 'asc' ? 1 : -1
  if (orderBy === 'createdAt') return { 'entry.createdAt': direction }
  return { [`entry.${orderBy}`]: direction, 'entry.createdAt': -1 }
}

export class MongoMemoryRepository extends MemoryMemoryRepository {
  private readonly gateway: MongoDocRepository<MemoryEntry, MongoMemoryDocument>

  constructor(
    collection: MongoMemoryCollection,
    options: MongoMemoryRepositoryOptions = {},
  ) {
    super()
    const name = options.collectionName ?? 'elysia_memories'
    this.gateway = new MongoDocRepository<MemoryEntry, MongoMemoryDocument>(collection, {
      modelKey: 'entry',
      toModel: (doc) => doc.entry,
      cloneModel: cloneEntry,
      // 【B4】索引与查询下推形状对齐：
      // - life_created：lifeId 维度的默认 createdAt 排序分页；
      // - stimulus：listByStimulusId（写路径去重查找）无 lifeId 维度（签名只有 stimulusId，
      //   跨 life 查询），故保留单字段前缀；lifeId 前缀复合索引无法服务该形状；
      // - life_status_owner：collectCandidates 的 ownerType/ownerId/visibility 等值查询；
      // - life_importance：orderBy importance 的候选收集与 enforceMaxEntries 溢出排序；
      // - relations：relationTargetType/Id 的 $elemMatch 查询。
      indexes: options.ensureIndexes === false ? [] : [
        { keys: { 'entry.id': 1 }, options: { unique: true, name: `${name}_id_unique` } },
        { keys: { 'entry.lifeId': 1, 'entry.createdAt': -1 }, options: { name: `${name}_life_created` } },
        { keys: { 'entry.source.stimulusId': 1 }, options: { name: `${name}_stimulus` } },
        { keys: { 'entry.lifeId': 1, 'entry.status': 1, 'entry.ownerType': 1, 'entry.ownerId': 1, 'entry.createdAt': -1 }, options: { name: `${name}_life_status_owner` } },
        { keys: { 'entry.lifeId': 1, 'entry.status': 1, 'entry.importance': -1 }, options: { name: `${name}_life_importance` } },
        { keys: { 'entry.relations.targetType': 1, 'entry.relations.targetId': 1 }, options: { name: `${name}_relations` } },
      ],
    })
  }

  async ensureIndexes(): Promise<void> {
    await this.gateway.ensureIndexes()
  }

  /** 把单个 id 的文档从 Mongo 装入本地 Map（供 super.update/remove 操作），仅取一条而非全表。 */
  private async ensureLocal(id: string): Promise<void> {
    if (await super.getById(id)) return
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) await super.save(fromMongo)
  }

  async getById(id: string): Promise<MemoryEntry | undefined> {
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) return fromMongo
    return super.getById(id)
  }

  async save(entry: MemoryEntry): Promise<void> {
    await super.save(entry)
    await this.gateway.upsert(entry.id, entry)
    // 本地 Map 只为 update/remove 的读-改-写短暂服务，写后即逐出，
    // 避免长生命周期进程无界增长（P1-15）。
    this.evictLocal(entry.id)
  }

  async update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
    // 强制用 Mongo 最新值覆盖本地副本再合并：本地缓存可能陈旧，
    // 直接合并后整文档 $set 会把其他进程的更新覆盖丢失（P1-15）。
    await this.ensureLocalRefresh(id)
    const updated = await super.update(id, patch)
    await this.gateway.upsert(updated.id, updated)
    this.evictLocal(id)
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.ensureLocalRefresh(id)
    await super.remove(id)
    const updated = await super.getById(id)
    if (updated) await this.gateway.upsert(updated.id, updated)
    this.evictLocal(id)
  }

  /**
   * 【D1-2】原子自增 accessCount（取代 service 层读-改-写），并落 lastAccessedAt。
   * 返回自增后的最新实体。
   */
  async incrementAccess(id: string, now: number): Promise<MemoryEntry | undefined> {
    await this.gateway.increment(id, 'accessCount', 1, { lastAccessedAt: now })
    await this.ensureLocalRefresh(id)
    return this.getById(id)
  }

  /** 强制用 Mongo 最新值刷新本地 Map（自增等服务端写后）。 */
  private async ensureLocalRefresh(id: string): Promise<void> {
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) await super.save(fromMongo)
  }

  /**
   * 【B2】查询下推：filter/sort/limit 直接下发 Mongo（findMany 单次往返），
   * 取代 D1-1 的 scopedByLife 子集加载路径（不再为查询物化整个 life 的内存仓储）。
   *
   * 语义对齐说明：
   * - 可精确下推的维度（等值/$in/$gte/$lte/$elemMatch、排序）由服务端完成；
   * - 窗口：服务端取 [0, limit+offset)（精滤路径放大 3 倍），页切片
   *   slice(offset, offset+limit) 在内存完成——skip 不下推，保证精滤路径与
   *   精确路径共用同一条切片逻辑；
   * - text（子串）与 tags（大小写不敏感 ALL）无法精确下推：拉取放大窗口后
   *   在内存精滤再截断（放大约束为既定取舍，命中集超过放大窗口时 total/尾页可能偏小）；
   * - total 为下推窗口内的计数（limit/offset 存在时不再全量计数——无生产消费方依赖全量 total）。
   */
  async query(query: MemoryQuery): Promise<MemorySearchResult> {
    const needsRefine = (query.text ?? '').trim().length > 0 || (query.tags?.length ?? 0) > 0
    const offset = query.offset ?? 0
    const windowLimit = query.limit !== undefined ? query.limit + offset : undefined
    const fetchLimit = needsRefine && windowLimit !== undefined ? windowLimit * 3 : windowLimit

    const findOptions: MongoFindOptions = { sort: buildMemorySort(query) }
    if (fetchLimit !== undefined) findOptions.limit = fetchLimit

    const fetched = await this.gateway.findMany(buildMemoryFilter(query), findOptions)

    const matched = needsRefine
      ? fetched
        .filter((entry) => textMatches(entry, query.text))
        .filter((entry) => hasAllTags(entry.tags, query.tags))
      : fetched

    return {
      entries: matched.slice(offset, query.limit !== undefined ? offset + query.limit : undefined),
      total: matched.length,
      query,
      retrievedAt: Date.now(),
    }
  }

  async listByLifeId(lifeId: string, options?: MemoryQueryOptions): Promise<MemoryEntry[]> {
    const result = await this.query({ lifeId, ...options })
    return result.entries
  }

  /**
   * 【B2】直查下推。内存版语义：跨 life（签名无 lifeId）、排除 deleted、createdAt 倒序。
   */
  async listByStimulusId(stimulusId: string): Promise<MemoryEntry[]> {
    return this.gateway.findMany(
      { 'entry.source.stimulusId': stimulusId, 'entry.status': { $ne: 'deleted' } },
      { sort: { 'entry.createdAt': -1 } },
    )
  }

  /** 【B3】服务端计数（countDocuments），取代 maxEntries+1000 窗口全拉。 */
  async countActiveByLife(lifeId: string): Promise<number> {
    return this.gateway.count({ 'entry.lifeId': lifeId, 'entry.status': 'active' })
  }

  /** 【B3】溢出集直查：(importance asc, createdAt asc) 序前 limit 条 active 记忆。 */
  async listOverflowingActiveByLife(lifeId: string, limit: number): Promise<MemoryEntry[]> {
    return this.gateway.findMany(
      { 'entry.lifeId': lifeId, 'entry.status': 'active' },
      { sort: { 'entry.importance': 1, 'entry.createdAt': 1 }, limit },
    )
  }
}

export interface DefaultMemoryServiceOptions {
  defaultImportance?: number
  defaultConfidence?: number
  maxEntriesPerLife?: number
  attributionMode?: MemoryAttributionMode
  attributor?: MemoryAttributor
}

export class DefaultMemoryService implements MemoryService {
  private readonly disposers: Array<() => void> = []
  private readonly attributor: MemoryAttributor

  constructor(
    private readonly repository: MemoryRepository,
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly logger?: RuntimeLogger,
    private readonly options: DefaultMemoryServiceOptions = {},
  ) {
    this.attributor = options.attributor ?? new DeterministicMemoryAttributor()
  }

  start(): void {
    this.disposers.push(
      this.eventBus.on('behavior.memory.update.requested', async (payload) => {
        try {
          const result = await this.processUpdateRequest({
            ...payload.request,
            source: {
              ...payload.request.source,
              behaviorPlanId: payload.planId ?? payload.request.source?.behaviorPlanId,
              executionPlanId: payload.planId ?? payload.request.source?.executionPlanId,
              executionActionId: payload.actionId ?? payload.request.source?.executionActionId,
              event: 'behavior.memory.update.requested',
            },
          })

          await this.eventBus.emit(result.created ? 'memory.created' : 'memory.updated', {
            requestId: result.requestId,
            entry: result.entry,
            result,
            planId: payload.planId,
            actionId: payload.actionId,
          })
        } catch (error) {
          await this.eventBus.emit('memory.update.failed', {
            requestId: payload.request.id,
            request: payload.request,
            error,
            planId: payload.planId,
            actionId: payload.actionId,
          })

          this.logger?.error('memory update request failed', error, {
            phase: 'memory',
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

  async processUpdateRequest(request: MemoryUpdateRequest): Promise<MemoryUpdateResult> {
    if (request.skipAttribution) {
      return this.update(request)
    }

    const result = await this.attributor.attribute({
      ...request,
      attributionMode: request.attributionMode ?? this.options.attributionMode ?? 'deterministic',
    })
    const [first, ...rest] = result.requests

    if (!first) {
      throw new Error(`memory attribution produced no requests: ${request.id}`)
    }

    const updateResult = await this.update(first)
    for (const attributedRequest of rest) {
      await this.update(attributedRequest)
    }

    return updateResult
  }

  async update(request: MemoryUpdateRequest): Promise<MemoryUpdateResult> {
    const now = Date.now()
    const attributed = request.skipAttribution || request.ownerType || request.ownerId || request.relations
      ? request
      : applyDeterministicAttribution(request)
    const content = resolveMemoryContent(attributed)
    const existing = await this.findExistingEntry(attributed)
    const baseImportance = attributed.importance ?? this.options.defaultImportance ?? 0.5
    const importance = clampUnitOr(baseImportance, 0.5)
    const confidence = clampUnitOr(attributed.confidence, this.options.defaultConfidence ?? 0.7)

    if (existing) {
      const entry = await this.repository.update(existing.id, {
        content,
        summary: attributed.summary ?? attributed.decisionSummary ?? existing.summary,
        tags: mergeTags(existing.tags, attributed.tags),
        actorId: attributed.actorId ?? existing.actorId,
        habitatId: attributed.habitatId ?? existing.habitatId,
        threadId: attributed.threadId ?? existing.threadId,
        projectionId: attributed.projectionId ?? existing.projectionId,
        ownerType: attributed.ownerType ?? existing.ownerType,
        ownerId: attributed.ownerId ?? existing.ownerId,
        relations: attributed.relations ? mergeRelations(existing.relations, attributed.relations) : existing.relations,
        visibility: attributed.visibility ?? existing.visibility,
        eventId: attributed.eventId ?? existing.eventId,
        eventType: attributed.eventType ?? existing.eventType,
        source: {
          ...existing.source,
          ...attributed.source,
          stimulusId: attributed.stimulusId ?? attributed.source?.stimulusId ?? existing.source?.stimulusId,
          outputId: attributed.outputId ?? attributed.source?.outputId ?? existing.source?.outputId,
        },
        importance: Math.max(existing.importance, importance),
        confidence: Math.max(existing.confidence, confidence),
        decay: attributed.decay ?? existing.decay,
        status: attributed.status ?? existing.status,
        updatedAt: now,
        metadata: {
          ...existing.metadata,
          ...attributed.metadata,
          lastMemoryUpdateRequestId: attributed.id,
        },
      })

      return {
        requestId: attributed.id,
        entry,
        created: false,
        updated: true,
        reason: 'merged-with-existing-source',
      }
    }

    const entry: MemoryEntry = {
      id: attributed.metadata?.memoryId && typeof attributed.metadata.memoryId === 'string'
        ? attributed.metadata.memoryId
        : nextMemoryId(),
      lifeId: attributed.lifeId,
      scope: attributed.scope ?? inferScope(attributed),
      kind: attributed.kind ?? inferKind(attributed),
      status: attributed.status ?? 'active',
      content,
      summary: attributed.summary ?? attributed.decisionSummary ?? attributed.stimulusSummary,
      tags: normalizeTags(attributed.tags),
      actorId: attributed.actorId,
      habitatId: attributed.habitatId,
      threadId: attributed.threadId,
      projectionId: attributed.projectionId,
      ownerType: attributed.ownerType,
      ownerId: attributed.ownerId,
      relations: attributed.relations?.map(cloneRelation),
      visibility: attributed.visibility,
      eventId: attributed.eventId,
      eventType: attributed.eventType,
      source: {
        ...attributed.source,
        stimulusId: attributed.stimulusId ?? attributed.source?.stimulusId,
        outputId: attributed.outputId ?? attributed.source?.outputId,
      },
      importance,
      confidence,
      decay: attributed.decay,
      createdAt: attributed.createdAt ?? now,
      updatedAt: now,
      accessCount: 0,
      metadata: {
        ...attributed.metadata,
        memoryUpdateRequestId: attributed.id,
      },
    }

    await this.repository.save(entry)
    await this.enforceMaxEntries(entry.lifeId)

    return {
      requestId: attributed.id,
      entry,
      created: true,
      updated: false,
      reason: 'created-new-entry',
    }
  }

  async retrieve(query: MemoryQuery): Promise<MemorySearchResult> {
    try {
      const result = await this.repository.query(query)
      const now = Date.now()
      const updatedEntries: MemoryEntry[] = []

      // 【D1-2】若仓储支持原子自增（Mongo），用 $inc 在服务端完成 accessCount，
      // 避免并发下读-改-写丢失更新；否则（内存仓储）退回原读-改-写。
      const atomic = this.repository as Partial<AtomicAccessRepository>
      for (const entry of result.entries) {
        if (typeof atomic.incrementAccess === 'function') {
          const updated = await atomic.incrementAccess(entry.id, now)
          updatedEntries.push(updated ?? {
            ...entry,
            accessCount: (entry.accessCount ?? 0) + 1,
            lastAccessedAt: now,
          })
        } else {
          const updated = await this.repository.update(entry.id, {
            accessCount: (entry.accessCount ?? 0) + 1,
            lastAccessedAt: now,
            updatedAt: entry.updatedAt,
          })
          updatedEntries.push(updated)
        }
      }

      const finalResult: MemorySearchResult = {
        ...result,
        entries: updatedEntries,
        retrievedAt: now,
      }

      await this.eventBus.emit('memory.retrieved', {
        query,
        result: finalResult,
      })

      return finalResult
    } catch (error) {
      await this.eventBus.emit('memory.retrieve.failed', {
        query,
        error,
      })
      throw error
    }
  }

  async consolidate(request: MemoryConsolidationRequest): Promise<MemoryConsolidationResult> {
    await this.eventBus.emit('memory.consolidation.requested', { request })

    try {
      const result = await this.repository.query({
        lifeId: request.lifeId,
        actorId: request.actorId,
        habitatId: request.habitatId,
        threadId: request.threadId,
        kind: request.kind,
        tags: request.tags,
        status: 'active',
        limit: 100,
        orderBy: 'createdAt',
        order: 'asc',
      })

      if (result.entries.length < 2) {
        const empty: MemoryConsolidationResult = {
          requestId: request.id,
          lifeId: request.lifeId,
          archivedEntryIds: [],
          created: false,
          reason: 'not-enough-entries',
          completedAt: Date.now(),
          metadata: request.metadata,
        }
        await this.eventBus.emit('memory.consolidated', {
          requestId: request.id,
          result: empty,
        })
        return empty
      }

      const now = Date.now()
      const [first, ...rest] = result.entries
      const consolidated: MemoryEntry = {
        ...first,
        id: nextMemoryId('memory-consolidated'),
        content: result.entries.map((entry) => entry.summary ?? entry.content).join('\n'),
        summary: `Consolidated ${result.entries.length} memories`,
        tags: mergeTags([], result.entries.flatMap((entry) => entry.tags ?? [])),
        relations: mergeRelations([], result.entries.flatMap((entry) => entry.relations ?? [])),
        importance: Math.max(...result.entries.map((entry) => entry.importance)),
        confidence: Math.max(...result.entries.map((entry) => entry.confidence)),
        source: {
          ...first.source,
          event: 'memory.consolidation',
          createdBy: 'memory-service',
        },
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        metadata: {
          ...first.metadata,
          ...request.metadata,
          consolidatedFrom: result.entries.map((entry) => entry.id),
        },
      }

      await this.repository.save(consolidated)
      for (const entry of rest) {
        await this.repository.update(entry.id, {
          status: 'archived',
          updatedAt: now,
          metadata: {
            ...entry.metadata,
            archivedBy: request.id,
            consolidatedInto: consolidated.id,
          },
        })
      }

      const consolidatedResult: MemoryConsolidationResult = {
        requestId: request.id,
        lifeId: request.lifeId,
        consolidatedEntry: consolidated,
        archivedEntryIds: rest.map((entry) => entry.id),
        created: true,
        reason: 'consolidated-active-entries',
        completedAt: now,
        metadata: request.metadata,
      }

      await this.eventBus.emit('memory.consolidated', {
        requestId: request.id,
        result: consolidatedResult,
      })

      return consolidatedResult
    } catch (error) {
      await this.eventBus.emit('memory.consolidation.failed', {
        requestId: request.id,
        request,
        error,
      })
      throw error
    }
  }

  private async findExistingEntry(request: MemoryUpdateRequest): Promise<MemoryEntry | undefined> {
    const sourceStimulusId = request.stimulusId ?? request.source?.stimulusId
    if (!sourceStimulusId) return undefined

    const entries = await this.repository.listByStimulusId(sourceStimulusId)
    return entries.find((entry) => (
      entry.lifeId === request.lifeId
      && entry.kind === (request.kind ?? inferKind(request))
      && entry.actorId === request.actorId
      && entry.ownerType === request.ownerType
      && entry.ownerId === request.ownerId
      // W3：archived 记忆不再被 merge 复活——上限淘汰的条目保持归档，
      // 同刺激新更新走新建（此前会静默合并回已归档条目）。
      && entry.status !== 'deleted'
      && entry.status !== 'archived'
    ))
  }

  private async enforceMaxEntries(lifeId: string): Promise<void> {
    const maxEntries = this.options.maxEntriesPerLife
    if (!maxEntries || maxEntries <= 0) return

    // 只统计 active 记忆（P0-4）：archived 记忆不占上限、也不会被再次选中。
    // 【B3】仓储实现计数能力（内存/Mongo 均内置）时走 count + 溢出集直查，
    // 只在超限时拉取恰好 count-max 条；第三方仓储未实现时回退旧的窗口拉取路径。
    const capacity = this.repository as Partial<MemoryEntryCapacityRepository>
    let overflow: MemoryEntry[]
    if (typeof capacity.countActiveByLife === 'function'
      && typeof capacity.listOverflowingActiveByLife === 'function') {
      const count = await capacity.countActiveByLife(lifeId)
      if (count <= maxEntries) return
      overflow = await capacity.listOverflowingActiveByLife(lifeId, count - maxEntries)
    } else {
      const entries = await this.repository.listByLifeId(lifeId, {
        includeDeleted: false,
        status: 'active',
        limit: maxEntries + 1000,
      })

      if (entries.length <= maxEntries) return

      overflow = entries
        .sort((a, b) => {
          const importance = a.importance - b.importance
          if (importance !== 0) return importance
          return a.createdAt - b.createdAt
        })
        .slice(0, entries.length - maxEntries)
    }

    for (const entry of overflow) {
      await this.repository.update(entry.id, {
        status: 'archived',
        updatedAt: Date.now(),
        metadata: {
          ...entry.metadata,
          archivedBy: 'maxEntriesPerLife',
        },
      })
    }
  }
}

function resolveMemoryContent(request: MemoryUpdateRequest): string {
  const content = request.content
    ?? request.stimulusSummary
    ?? request.decisionSummary
    ?? request.metadata?.content
    ?? request.metadata?.summary

  if (typeof content === 'string' && content.trim().length > 0) {
    return content
  }

  return `Memory update from stimulus ${request.stimulusId ?? request.source?.stimulusId ?? request.id}`
}

function inferScope(request: MemoryUpdateRequest): MemoryScope {
  if (request.ownerType) return ownerTypeToScope(request.ownerType)
  if (request.actorId) return 'actor'
  if (request.threadId) return 'thread'
  if (request.habitatId) return 'habitat'
  return 'life'
}

function inferKind(request: MemoryUpdateRequest): MemoryKind {
  if (request.eventType === 'news') return 'semantic'
  if (request.metadata?.kind === 'preference') return 'preference'
  if (request.metadata?.kind === 'relationship') return 'relationship'
  if (request.metadata?.kind === 'task') return 'task'
  return 'episodic'
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  return normalized.length > 0 ? normalized : undefined
}

function mergeTags(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  return normalizeTags([...(left ?? []), ...(right ?? [])])
}


export function createMemoryPluginRuntime(options: MemoryPluginRuntimeOptions): MemoryPluginRuntime | undefined {
  const { runtime, config, logger } = options

  logger.info('memory plugin apply started', {
    plugin: 'elysia-ai-memory',
    phase: 'apply',
  })

  if (config.enabled === false) {
    logger.info('memory plugin disabled by config', {
      plugin: 'elysia-ai-memory',
      phase: 'apply',
    })
    return undefined
  }

  const repository = options.repository ?? options.repositoryFactory?.({ config, logger }) ?? new MemoryMemoryRepository()
  const attributor = new DeterministicMemoryAttributor()
  const repositoryType = repository instanceof MongoMemoryRepository ? 'mongo' : 'memory'
  void runtime.context.eventBus.emit('repository.initialized', {
    component: 'memory',
    repositoryType,
    metadata: {
      plugin: 'elysia-ai-memory',
      provider: repository.constructor.name,
    },
  })

  if (repositoryType === 'memory' && !options.repository && !options.repositoryFactory) {
    void runtime.context.eventBus.emit('repository.fallback-to-memory', {
      component: 'memory',
      repositoryType,
      reason: 'default-in-memory-repository',
      metadata: { plugin: 'elysia-ai-memory' },
    })
  }

  const relevanceSelector = new RuleBasedMemoryRelevanceSelector()
  const service = new DefaultMemoryService(
    repository,
    runtime.context.eventBus,
    logger,
    {
      attributor,
      maxEntriesPerLife: config.maxEntriesPerLife,
    },
  )
  const contextProvider = new RuleBasedMemoryContextProvider(
    repository,
    runtime.context.eventBus,
    {
      defaultLimit: config.contextLimit,
      selector: relevanceSelector,
    },
  )
  const memoryPluginService: MemoryPluginService = {
    repository,
    service,
    attributor,
    contextProvider,
    relevanceSelector,
  }

  service.start?.()

  logger.info('memory plugin ready', {
    plugin: 'elysia-ai-memory',
    phase: 'apply',
    contextLimit: config.contextLimit,
    hasMaxEntriesPerLife: typeof config.maxEntriesPerLife === 'number',
    repositoryType: repository instanceof MongoMemoryRepository ? 'mongo' : 'memory',
  })

  return {
    service: memoryPluginService,
    repository,
    memoryService: service,
    contextProvider,
    dispose() {
      service.stop?.()
      logger.info('memory plugin disposed', {
        plugin: 'elysia-ai-memory',
        phase: 'dispose',
      })
    },
  }
}
