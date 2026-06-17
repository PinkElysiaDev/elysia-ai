import type { DialogueRole } from './dialogue.js'

export interface ConversationEntry {
  role: Extract<DialogueRole, 'user' | 'assistant'>
  content: string
  timestamp: number
  stimulusId?: string
  lifeId?: string
  scopeKey?: string
  metadata?: Record<string, unknown>
}

export interface ConversationStore {
  append(scopeKey: string, entry: ConversationEntry): void
  getRecent(scopeKey: string, limit?: number): ConversationEntry[]
  clear(scopeKey: string): void
}

export type MemoryKind =
  | 'episodic'
  | 'semantic'
  | 'preference'
  | 'relationship'
  | 'self'
  | 'task'
  | 'system'

export type MemoryScope =
  | 'life'
  | 'actor'
  | 'habitat'
  | 'thread'
  | 'projection'
  | 'global'

export type MemoryStatus =
  | 'active'
  | 'archived'
  | 'suppressed'
  | 'deleted'

export type MemoryOwnerType =
  | 'life'
  | 'actor'
  | 'habitat'
  | 'thread'
  | 'projection'
  | 'event'
  | 'global'

export type MemoryVisibility =
  | 'private'
  | 'shared'
  | 'habitat'
  | 'global'

export type MemoryRelationRole =
  | 'subject'
  | 'participant'
  | 'mentioned'
  | 'observer'
  | 'location'
  | 'source'
  | 'shared-with'

export type MemoryAttributionMode =
  | 'deterministic'
  | 'ai-assisted'

export interface MemoryRelation {
  targetType: MemoryOwnerType
  targetId: string
  role: MemoryRelationRole
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface MemorySource {
  stimulusId?: string
  behaviorPlanId?: string
  executionPlanId?: string
  executionActionId?: string
  dialogueTaskId?: string
  outputId?: string
  event?: string
  createdBy?: string
}

export interface MemoryEntry {
  id: string
  lifeId: string
  scope: MemoryScope
  kind: MemoryKind
  status: MemoryStatus

  content: string
  summary?: string
  tags?: string[]

  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string

  ownerType?: MemoryOwnerType
  ownerId?: string
  relations?: MemoryRelation[]
  visibility?: MemoryVisibility
  eventId?: string
  eventType?: string

  source?: MemorySource

  importance: number
  confidence: number
  decay?: number

  createdAt: number
  updatedAt: number
  lastAccessedAt?: number
  accessCount?: number

  metadata?: Record<string, unknown>
}

export interface MemoryQueryOptions {
  limit?: number
  offset?: number
  includeDeleted?: boolean
}

export interface MemoryQuery extends MemoryQueryOptions {
  lifeId: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  stimulusId?: string

  scope?: MemoryScope | MemoryScope[]
  kind?: MemoryKind | MemoryKind[]
  status?: MemoryStatus | MemoryStatus[]

  ownerType?: MemoryOwnerType | MemoryOwnerType[]
  ownerId?: string
  relationTargetType?: MemoryOwnerType
  relationTargetId?: string
  relationRole?: MemoryRelationRole
  visibility?: MemoryVisibility | MemoryVisibility[]
  eventId?: string
  eventType?: string

  tags?: string[]
  text?: string

  minImportance?: number
  minConfidence?: number

  createdAfter?: number
  createdBefore?: number

  orderBy?: 'createdAt' | 'updatedAt' | 'importance' | 'lastAccessedAt'
  order?: 'asc' | 'desc'
}

export type MemoryContextMode =
  | 'rule-based'
  | 'ai-assisted'

export type MemoryContextMatchSource =
  | 'actor'
  | 'thread'
  | 'habitat'
  | 'global'
  | 'relation'
  | 'text'
  | 'importance'
  | 'recency'

export interface MemoryContextItem {
  entry: MemoryEntry
  score: number
  reason: string
  matchedBy: MemoryContextMatchSource[]
  metadata?: Record<string, unknown>
}

export interface MemoryContextRequest {
  lifeId: string
  stimulusId?: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  content?: string
  query?: Partial<MemoryQuery>
  limit?: number
  mode?: MemoryContextMode
  includeGlobal?: boolean
  includeHabitat?: boolean
  metadata?: Record<string, unknown>
}

export interface MemoryContextPack {
  lifeId: string
  stimulusId?: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  mode: MemoryContextMode
  items: MemoryContextItem[]
  totalCandidates: number
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface MemoryRelevanceSelectionRequest {
  contextRequest: MemoryContextRequest
  candidates: MemoryContextItem[]
  content?: string
  limit?: number
  mode: 'ai-assisted'
  metadata?: Record<string, unknown>
}

export interface MemoryRelevanceSelectionResult {
  items: MemoryContextItem[]
  selectedIds: string[]
  rejectedIds: string[]
  reason: string
  usedAI: boolean
  fallbackReason?: string
  metadata?: Record<string, unknown>
}

export interface MemoryRelevanceSelector {
  select(request: MemoryRelevanceSelectionRequest): Promise<MemoryRelevanceSelectionResult>
}

export interface MemoryContextProvider {
  buildContext(request: MemoryContextRequest): Promise<MemoryContextPack>
}

export interface MemorySearchResult {
  entries: MemoryEntry[]
  total: number
  query: MemoryQuery
  retrievedAt: number
}

export interface MemoryUpdateRequest {
  id: string
  stimulusId?: string
  lifeId: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string

  scope?: MemoryScope
  kind?: MemoryKind
  status?: MemoryStatus

  ownerType?: MemoryOwnerType
  ownerId?: string
  relations?: MemoryRelation[]
  visibility?: MemoryVisibility
  eventId?: string
  eventType?: string
  attributionMode?: MemoryAttributionMode
  skipAttribution?: boolean

  content?: string
  summary?: string
  tags?: string[]

  importance?: number
  confidence?: number
  salience?: number
  decay?: number

  stimulusSummary?: string
  decisionSummary?: string
  outputId?: string

  source?: MemorySource
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface MemoryUpdateResult {
  requestId: string
  entry: MemoryEntry
  created: boolean
  updated: boolean
  reason: string
}

export interface MemoryAttributionInput {
  lifeId: string
  stimulusId?: string
  content: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  candidateId?: string
  decisionId?: string
  mode?: MemoryAttributionMode
  metadata?: Record<string, unknown>
}

export interface MemoryAttributionDiagnostics {
  reason?: string
  usedAI?: boolean
  fallbackReason?: string
  metadata?: Record<string, unknown>
}

export interface MemoryAttributionResult {
  mode: MemoryAttributionMode
  requests: MemoryUpdateRequest[]
  diagnostics?: MemoryAttributionDiagnostics
}

export interface MemoryAttributor {
  attribute(request: MemoryUpdateRequest): Promise<MemoryAttributionResult>
}

export interface MemoryConsolidationRequest {
  id: string
  lifeId: string
  actorId?: string
  habitatId?: string
  threadId?: string
  kind?: MemoryKind
  tags?: string[]
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface MemoryConsolidationResult {
  requestId: string
  lifeId: string
  consolidatedEntry?: MemoryEntry
  archivedEntryIds: string[]
  created: boolean
  reason: string
  completedAt: number
  metadata?: Record<string, unknown>
}

export interface MemoryRepository {
  getById(id: string): Promise<MemoryEntry | undefined>
  save(entry: MemoryEntry): Promise<void>
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>
  remove(id: string): Promise<void>
  query(query: MemoryQuery): Promise<MemorySearchResult>
  listByLifeId(lifeId: string, options?: MemoryQueryOptions): Promise<MemoryEntry[]>
  listByStimulusId(stimulusId: string): Promise<MemoryEntry[]>
}

export interface MemoryService {
  update(request: MemoryUpdateRequest): Promise<MemoryUpdateResult>
  retrieve(query: MemoryQuery): Promise<MemorySearchResult>
  consolidate(request: MemoryConsolidationRequest): Promise<MemoryConsolidationResult>
}
