export type BondTargetType =
  | 'actor'
  | 'life'
  | 'habitat'
  | 'thread'
  | 'projection'
  | 'external'
  | 'individual'
  | 'collective'
  | 'channel'

export type BondStatus =
  | 'active'
  | 'archived'
  | 'blocked'
  | 'deleted'

export interface BondMetrics {
  familiarity: number
  intimacy: number
  trust: number
  tension: number
  dependence: number
}

export interface BondSource {
  stimulusId?: string
  memoryId?: string
  behaviorPlanId?: string
  executionPlanId?: string
  executionActionId?: string
  event?: string
  updatedBy?: string
}

export interface Bond {
  id: string
  lifeId: string
  /**
   * @deprecated use lifeId
   */
  lifeInstanceId?: string
  targetId: string
  targetType: BondTargetType
  status: BondStatus
  metrics: BondMetrics
  /**
   * @deprecated use metrics.familiarity
   */
  familiarity?: number
  /**
   * @deprecated use metrics.intimacy
   */
  intimacy?: number
  /**
   * @deprecated use metrics.trust
   */
  trust?: number
  summary?: string
  tags?: string[]
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  source?: BondSource
  createdAt: number
  updatedAt: number
  lastInteractionAt?: number
  interactionCount?: number
  metadata?: Record<string, unknown>
}

export interface BondUpdateRequest {
  id: string
  stimulusId?: string
  lifeId: string
  targetId?: string
  targetType?: BondTargetType
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  interactionType?: string
  sentiment?: 'positive' | 'neutral' | 'negative' | string
  delta?: Partial<BondMetrics>
  deltaSuggestion?: number
  summary?: string
  tags?: string[]
  source?: BondSource
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface BondUpdateResult {
  requestId: string
  bond: Bond
  created: boolean
  updated: boolean
  delta: Partial<BondMetrics>
  reason: string
}

export interface BondQueryOptions {
  targetId?: string
  targetType?: BondTargetType | BondTargetType[]
  status?: BondStatus | BondStatus[]
  tags?: string[]
  minFamiliarity?: number
  minIntimacy?: number
  minTrust?: number
  minTension?: number
  minDependence?: number
  updatedAfter?: number
  updatedBefore?: number
  includeDeleted?: boolean
  limit?: number
  offset?: number
  orderBy?: 'updatedAt' | 'createdAt' | 'familiarity' | 'intimacy' | 'trust' | 'tension' | 'dependence' | 'interactionCount'
  order?: 'asc' | 'desc'
}

export interface BondQuery extends BondQueryOptions {
  lifeId: string
}

export type BondContextMode =
  | 'rule-based'
  | 'ai-assisted'

export type BondContextMatchSource =
  | 'actor'
  | 'thread'
  | 'habitat'
  | 'projection'
  | 'target'
  | 'metrics'
  | 'recency'

export interface BondContextItem {
  bond: Bond
  score: number
  reason: string
  matchedBy: BondContextMatchSource[]
  metadata?: Record<string, unknown>
}

export interface BondContextRequest {
  lifeId: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  targetId?: string
  targetType?: BondTargetType
  limit?: number
  mode?: BondContextMode
  query?: Partial<BondQuery>
  metadata?: Record<string, unknown>
}

export interface BondContextPack {
  lifeId: string
  actorId?: string
  habitatId?: string
  threadId?: string
  projectionId?: string
  mode: BondContextMode
  items: BondContextItem[]
  totalCandidates: number
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface BondRelevanceSelectionRequest {
  contextRequest: BondContextRequest
  candidates: BondContextItem[]
  content?: string
  limit?: number
  mode: 'ai-assisted'
  metadata?: Record<string, unknown>
}

export interface BondRelevanceSelectionResult {
  items: BondContextItem[]
  selectedIds: string[]
  rejectedIds: string[]
  reason: string
  usedAI: boolean
  fallbackReason?: string
  metadata?: Record<string, unknown>
}

export interface BondRelevanceSelector {
  select(request: BondRelevanceSelectionRequest): Promise<BondRelevanceSelectionResult>
}

export interface BondContextProvider {
  buildContext(request: BondContextRequest): Promise<BondContextPack>
}

export interface BondSearchResult {
  bonds: Bond[]
  total: number
  query: BondQuery
  retrievedAt: number
}

export interface BondService {
  start?(): void
  stop?(): void
  update(request: BondUpdateRequest): Promise<BondUpdateResult>
  retrieve(query: BondQuery): Promise<BondSearchResult>
}
