export type ObservedEventKind =
  | 'runtime'
  | 'life'
  | 'stimulus'
  | 'behavior'
  | 'dialogue'
  | 'brain'
  | 'gateway'
  | 'sender'
  | 'body'
  | 'scheduler'
  | 'memory'
  | 'bond'
  | 'homeostasis'
  | 'repository'

export type ObservedEventStatus =
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'loaded'
  | 'completed'
  | 'failed'
  | 'received'
  | 'selected'
  | 'planned'
  | 'created'
  | 'generated'
  | 'requested'
  | 'responded'
  | 'sent'
  | 'skipped'
  | 'retrieved'
  | 'updated'
  | 'consolidated'
  | 'initialized'

export interface ObservedEventRecord {
  id: string
  kind: ObservedEventKind
  event: string
  timestamp: number
  stimulusId?: string
  outputId?: string
  taskId?: string
  executionPlanId?: string
  executionActionId?: string
  scheduledTaskId?: string
  memoryId?: string
  memoryRequestId?: string
  bondId?: string
  bondRequestId?: string
  bondTargetId?: string
  bondTargetType?: string
  homeostasisRequestId?: string
  lifeId?: string
  habitatId?: string
  scopeType?: string
  status: ObservedEventStatus
  summary: string
  metadata?: Record<string, unknown>
}

export interface StimulusTrace {
  stimulusId: string
  events: ObservedEventRecord[]
}

export interface ObservatoryQuery {
  kind?: ObservedEventKind
  event?: string
  status?: ObservedEventStatus
  stimulusId?: string
  taskId?: string
  component?: string
  providerId?: string
  repositoryType?: string
  errorCode?: string
  since?: number
  until?: number
  limit?: number
}

export interface GatewayFailureRecord {
  event: ObservedEventRecord
  providerId?: string
  providerType?: string
  slot?: string
  model?: string
  errorCode?: string
  fallbackChain?: string[]
  selectedFallbackSlot?: string
  failedOver?: boolean
  retryCount?: number
}

export interface GatewayAnalytics {
  totalGatewayEvents: number
  requestCount: number
  responseCount: number
  failureCount: number
  failedOverCount: number
  circuitOpenCount: number
  byProviderId: Record<string, number>
  byErrorCode: Record<string, number>
  byFallbackSlot: Record<string, number>
  recentFailures: GatewayFailureRecord[]
}


export interface RepositoryAnalytics {
  totalRepositoryEvents: number
  initializedCount: number
  fallbackCount: number
  queryFailureCount: number
  writeFailureCount: number
  byComponent: Record<string, number>
  byRepositoryType: Record<string, number>
}


export interface OperationalFailureSummary {
  event: string
  kind: ObservedEventKind
  status: ObservedEventStatus
  timestamp: number
  summary: string
  providerId?: string
  providerType?: string
  model?: string
  component?: string
  repositoryType?: string
  errorCode?: string
}

export interface OperationalSnapshot {
  since: number
  generatedAt: number
  totalRecentEvents: number
  failureCount: number
  loadedComponents: string[]
  gatewayAnalytics: GatewayAnalytics
  repositoryAnalytics: RepositoryAnalytics
  recentFailures: OperationalFailureSummary[]
}

export interface ObservatorySnapshot {
  recentEvents: ObservedEventRecord[]
  /**
   * 当前内存中仍可查询 trace 的 stimulus 数量。
   *
   * 这里保留 activeStimulusCount 是为了兼容早期调用方，
   * 语义上它表示 tracked stimulus count，而不是“仍在处理中的活跃刺激”。
   */
  activeStimulusCount: number
  trackedStimulusCount: number
  dialogueCount: number
  gatewayCount: number
  failureCount: number
  since: number
  gatewayAnalytics?: GatewayAnalytics
  repositoryAnalytics?: RepositoryAnalytics
}
