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
  repository?: MemoryRepositoryConfig
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
      if (entry.threadId && request.threadId) return entry.threadId === request.threadId
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
  id: string
  entry: MemoryEntry
  createdAt: number
  updatedAt: number
}

export interface MongoMemoryCollection {
  findOne(filter: Record<string, unknown>): Promise<MongoMemoryDocument | null>
  find(filter: Record<string, unknown>): { toArray(): Promise<MongoMemoryDocument[]> } | Promise<MongoMemoryDocument[]>
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
}


/**
 * 【D1-2】支持原子访问计数的仓储能力（Mongo 实现）。
 * service 层用鸭子类型探测此能力：存在则走服务端 $inc，否则退回读-改-写。
 */
export interface AtomicAccessRepository {
  incrementAccess(id: string, now: number): Promise<MemoryEntry | undefined>
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
      indexes: options.ensureIndexes === false ? [] : [
        { keys: { id: 1 }, options: { unique: true, name: `${name}_id_unique` } },
        { keys: { 'entry.lifeId': 1, 'entry.createdAt': -1 }, options: { name: `${name}_life_created` } },
        { keys: { 'entry.source.stimulusId': 1 }, options: { name: `${name}_stimulus` } },
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

  /**
   * 【D1-1】按 lifeId 服务端缩小集合后，在子集上跑继承的内存过滤逻辑。
   * 取代旧的 hydrate() 全表加载：只 find({ 'entry.lifeId': lifeId })，零语义偏移。
   */
  private async scopedByLife(lifeId: string): Promise<MemoryMemoryRepository> {
    const entries = await this.gateway.findMany({ 'entry.lifeId': lifeId })
    const scoped = new MemoryMemoryRepository()
    for (const entry of entries) await scoped.save(entry)
    return scoped
  }

  async getById(id: string): Promise<MemoryEntry | undefined> {
    const fromMongo = await this.gateway.findById(id)
    if (fromMongo) return fromMongo
    return super.getById(id)
  }

  async save(entry: MemoryEntry): Promise<void> {
    await super.save(entry)
    await this.gateway.upsert(entry.id, entry)
  }

  async update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
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

  async query(query: MemoryQuery): Promise<MemorySearchResult> {
    const scoped = await this.scopedByLife(query.lifeId)
    return scoped.query(query)
  }

  async listByLifeId(lifeId: string, options?: MemoryQueryOptions): Promise<MemoryEntry[]> {
    const scoped = await this.scopedByLife(lifeId)
    return scoped.listByLifeId(lifeId, options)
  }

  async listByStimulusId(stimulusId: string): Promise<MemoryEntry[]> {
    const entries = await this.gateway.findMany({ 'entry.source.stimulusId': stimulusId })
    const scoped = new MemoryMemoryRepository()
    for (const entry of entries) await scoped.save(entry)
    return scoped.listByStimulusId(stimulusId)
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
    const baseImportance = attributed.importance ?? attributed.salience ?? this.options.defaultImportance ?? 0.5
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
      && entry.status !== 'deleted'
    ))
  }

  private async enforceMaxEntries(lifeId: string): Promise<void> {
    const maxEntries = this.options.maxEntriesPerLife
    if (!maxEntries || maxEntries <= 0) return

    const entries = await this.repository.listByLifeId(lifeId, {
      includeDeleted: false,
      limit: maxEntries + 1000,
    })

    if (entries.length <= maxEntries) return

    const overflow = entries
      .sort((a, b) => {
        const importance = a.importance - b.importance
        if (importance !== 0) return importance
        return a.createdAt - b.createdAt
      })
      .slice(0, entries.length - maxEntries)

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
  const repositoryType = config.repository?.type ?? 'memory'
  void runtime.context.eventBus.emit('repository.initialized', {
    component: 'memory',
    repositoryType,
    collectionName: config.repository?.mongo?.collectionName,
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
    repositoryType: config.repository?.type ?? 'memory',
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
