import type { CoreEventMap } from '@elysia-ai/core'
import type {
  GatewayAnalytics,
  GatewayFailureRecord,
  ObservedEventKind,
  ObservedEventRecord,
  ObservedEventStatus,
  OperationalFailureSummary,
  OperationalSnapshot,
  ObservatoryQuery,
  ObservatorySnapshot,
  RepositoryAnalytics,
  StimulusTrace,
} from './types.js'
import { ObservatoryStore } from './store.js'

let eventCounter = 0

function nextId(): string {
  return `obs-${Date.now()}-${++eventCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.length > 0)
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

function getNested(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function kindFromEvent(event: string): ObservedEventKind {
  const kind = event.split('.')[0]
  switch (kind) {
    case 'runtime':
    case 'life':
    case 'stimulus':
    case 'behavior':
    case 'dialogue':
    case 'brain':
    case 'gateway':
    case 'sender':
    case 'body':
    case 'scheduler':
    case 'memory':
    case 'bond':
    case 'homeostasis':
    case 'repository':
      return kind
    default:
      return 'runtime'
  }
}

function statusFromEvent(event: string): ObservedEventStatus {
  if (event.endsWith('.failed')) return 'failed'
  const action = event.split('.')[1]
  switch (action) {
    case 'starting':
    case 'started':
    case 'stopping':
    case 'stopped':
    case 'loaded':
    case 'completed':
    case 'failed':
    case 'received':
    case 'selected':
    case 'planned':
    case 'created':
    case 'generated':
    case 'requested':
    case 'responded':
    case 'sent':
    case 'skipped':
    case 'retrieved':
    case 'updated':
    case 'consolidated':
    case 'initialized':
      return action
    default:
      return 'completed'
  }
}

function extractStimulusId(event: string, payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.stimulusId) ??
    asString(getNested(payload, ['stimulus', 'id'])) ??
    firstString(getNested(payload, ['task', 'sourceStimulusIds'])) ??
    firstString(getNested(payload, ['request', 'metadata', 'sourceStimulusIds'])) ??
    firstString(getNested(payload, ['response', 'metadata', 'sourceStimulusIds'])) ??
    asString(getNested(payload, ['task', 'target', 'sourceStimulusId'])) ??
    asString(getNested(payload, ['task', 'payload', 'sourceStimulusId'])) ??
    asString(getNested(payload, ['result', 'scheduledTask', 'payload', 'sourceStimulusId'])) ??
    asString(getNested(payload, ['plan', 'stimulusId'])) ??
    asString(getNested(payload, ['action', 'payload', 'request', 'stimulusId'])) ??
    asString(getNested(payload, ['result', 'scheduledTask', 'payload', 'stimulus', 'metadata', 'originalStimulusId'])) ??
    asString(getNested(payload, ['instruction', 'stimulusId'])) ??
    asString(getNested(payload, ['request', 'stimulusId'])) ??
    asString(getNested(payload, ['result', 'state', 'metadata', 'lastHomeostasisUpdateSource', 'stimulusId']))
  )
}

function extractOutputId(payload: Record<string, unknown>): string | undefined {
  return asString(payload.outputId)
}

function extractTaskId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.taskId) ??
    asString(getNested(payload, ['result', 'taskId'])) ??
    asString(getNested(payload, ['task', 'id'])) ??
    asString(getNested(payload, ['task', 'metadata', 'taskId'])) ??
    asString(getNested(payload, ['request', 'task']))
  )
}

function extractExecutionPlanId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.planId) ??
    asString(getNested(payload, ['plan', 'id'])) ??
    asString(getNested(payload, ['task', 'payload', 'behaviorExecutionPlanId'])) ??
    asString(getNested(payload, ['result', 'planId']))
  )
}

function extractExecutionActionId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.actionId) ??
    asString(getNested(payload, ['action', 'id'])) ??
    asString(getNested(payload, ['task', 'payload', 'behaviorExecutionActionId'])) ??
    asString(getNested(payload, ['result', 'actionId']))
  )
}

function extractRequestId(payload: Record<string, unknown>, kind: 'memory' | 'bond' | 'homeostasis'): string | undefined {
  return (
    asString(payload.requestId) ??
    asString(getNested(payload, ['request', 'id'])) ??
    asString(getNested(payload, ['result', 'requestId']))
  )
}

function extractMemoryId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.memoryId) ??
    asString(getNested(payload, ['entry', 'id'])) ??
    asString(getNested(payload, ['result', 'entry', 'id'])) ??
    asString(getNested(payload, ['result', 'consolidatedEntry', 'id']))
  )
}

function extractBondId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.bondId) ??
    asString(getNested(payload, ['bond', 'id'])) ??
    asString(getNested(payload, ['result', 'bond', 'id']))
  )
}

function extractBondTargetId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(getNested(payload, ['bond', 'targetId'])) ??
    asString(getNested(payload, ['result', 'bond', 'targetId'])) ??
    asString(getNested(payload, ['request', 'targetId'])) ??
    asString(getNested(payload, ['request', 'actorId'])) ??
    asString(getNested(payload, ['request', 'habitatId']))
  )
}

function extractBondTargetType(payload: Record<string, unknown>): string | undefined {
  return (
    asString(getNested(payload, ['bond', 'targetType'])) ??
    asString(getNested(payload, ['result', 'bond', 'targetType'])) ??
    asString(getNested(payload, ['request', 'targetType']))
  )
}

function extractLifeId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.lifeId) ??
    asString(getNested(payload, ['instruction', 'lifeId'])) ??
    asString(getNested(payload, ['request', 'lifeId'])) ??
    asString(getNested(payload, ['entry', 'lifeId'])) ??
    asString(getNested(payload, ['result', 'entry', 'lifeId'])) ??
    asString(getNested(payload, ['bond', 'lifeId'])) ??
    asString(getNested(payload, ['result', 'bond', 'lifeId'])) ??
    asString(getNested(payload, ['state', 'lifeInstanceId'])) ??
    asString(getNested(payload, ['result', 'state', 'lifeInstanceId'])) ??
    asString(getNested(payload, ['task', 'lifeId']))
  )
}

function extractHabitatId(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.habitatId) ??
    asString(getNested(payload, ['stimulus', 'habitatId'])) ??
    asString(getNested(payload, ['request', 'habitatId'])) ??
    asString(getNested(payload, ['entry', 'habitatId'])) ??
    asString(getNested(payload, ['result', 'entry', 'habitatId'])) ??
    asString(getNested(payload, ['task', 'habitatId'])) ??
    asString(getNested(payload, ['task', 'target', 'habitatId']))
  )
}

function extractScopeType(payload: Record<string, unknown>): string | undefined {
  return (
    asString(getNested(payload, ['scope', 'type'])) ??
    asString(getNested(payload, ['entry', 'scope'])) ??
    asString(getNested(payload, ['result', 'entry', 'scope'])) ??
    asString(getNested(payload, ['task', 'scope', 'type'])) ??
    asString(getNested(payload, ['instruction', 'plan', 'scope', 'type']))
  )
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return { message: String(error) }
}

// 承载用户/模型自然语言内容的字段：在脱敏时只保留长度/数量摘要，
// 避免完整 prompt、记忆文本、系统提示词等内容泄露进 observatory trace。
const TEXT_CONTENT_KEYS = new Set([
  'content',
  'text',
  'summary',
  'systemprompt',
  'prompt',
  'usermessage',
  'reply',
  'output',
])

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 4) return '[MaxDepth]'
  if (value === null) return null
  if (value === undefined) return undefined

  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }
  if (valueType === 'function') {
    return '[Function]'
  }
  if (value instanceof Error) {
    return summarizeError(value)
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1, seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase()
      if (
        normalizedKey.includes('apikey')
        || normalizedKey.includes('api_key')
        || normalizedKey.includes('secret')
        || normalizedKey.includes('token')
        || normalizedKey.includes('authorization')
      ) {
        output[key] = '[Redacted]'
        continue
      }
      if (key === 'messages' && Array.isArray(child)) {
        output[key] = { count: child.length }
        continue
      }
      // 任何承载用户/模型自然语言内容的字段都按长度/数量摘要，避免泄露完整 prompt。
      // content 可能是字符串（普通文本）或数组（Koishi 消息元素），两者都需摘要。
      if (TEXT_CONTENT_KEYS.has(normalizedKey)) {
        if (typeof child === 'string') {
          output[key] = { length: child.length }
          continue
        }
        if (Array.isArray(child)) {
          output[key] = { count: child.length }
          continue
        }
      }
      output[key] = sanitizeValue(child, depth + 1, seen)
    }

    return output
  }

  return String(value)
}

function sanitizePayload(payload: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(payload)
  return isRecord(sanitized) ? sanitized : { value: sanitized }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length > 0 ? strings : undefined
}

function incrementCounter(counter: Record<string, number>, key: unknown): void {
  if (typeof key !== 'string' || key.length === 0) return
  counter[key] = (counter[key] ?? 0) + 1
}

function extractGatewayFailureRecord(event: ObservedEventRecord): GatewayFailureRecord {
  const metadata = asRecord(event.metadata)
  const diagnostics = asRecord(metadata.diagnostics)
  const route = asRecord(diagnostics.route)
  const finalErrorCode = asString(diagnostics.finalErrorCode) ?? asString(getNested(metadata, ['error', 'code']))

  return {
    event,
    providerId: asString(route.providerId),
    providerType: asString(route.providerType),
    slot: asString(route.slot),
    model: asString(route.model),
    errorCode: finalErrorCode,
    fallbackChain: asStringArray(diagnostics.fallbackChain),
    selectedFallbackSlot: asString(diagnostics.selectedFallbackSlot),
    failedOver: typeof diagnostics.failedOver === 'boolean' ? diagnostics.failedOver : undefined,
    retryCount: typeof diagnostics.retryCount === 'number' ? diagnostics.retryCount : undefined,
  }
}

function createGatewayAnalytics(events: ObservedEventRecord[], recentFailureLimit = 10): GatewayAnalytics {
  const gatewayEvents = events.filter((event) => event.kind === 'gateway')
  const byProviderId: Record<string, number> = {}
  const byErrorCode: Record<string, number> = {}
  const byFallbackSlot: Record<string, number> = {}
  const recentFailures: GatewayFailureRecord[] = []

  let requestCount = 0
  let responseCount = 0
  let failureCount = 0
  let failedOverCount = 0
  let circuitOpenCount = 0

  for (const event of gatewayEvents) {
    const metadata = asRecord(event.metadata)
    const diagnostics = asRecord(metadata.diagnostics)
    const route = asRecord(diagnostics.route)

    incrementCounter(byProviderId, route.providerId)

    if (event.event === 'gateway.requested') requestCount++
    if (event.event === 'gateway.responded') responseCount++
    if (event.event === 'gateway.failed') {
      failureCount++
      const failureRecord = extractGatewayFailureRecord(event)
      recentFailures.push(failureRecord)
      incrementCounter(byErrorCode, failureRecord.errorCode)
    }

    if (diagnostics.failedOver === true) {
      failedOverCount++
      incrementCounter(byFallbackSlot, diagnostics.selectedFallbackSlot)
    }

    const attempts = Array.isArray(diagnostics.attempts) ? diagnostics.attempts : []
    if (attempts.some((attempt) => asRecord(attempt).errorCode === 'circuit-open')) {
      circuitOpenCount++
    }
  }

  return {
    totalGatewayEvents: gatewayEvents.length,
    requestCount,
    responseCount,
    failureCount,
    failedOverCount,
    circuitOpenCount,
    byProviderId,
    byErrorCode,
    byFallbackSlot,
    recentFailures: recentFailures.slice(-recentFailureLimit),
  }
}


function createRepositoryAnalytics(events: ObservedEventRecord[]): RepositoryAnalytics {
  const repositoryEvents = events.filter((event) => event.kind === 'repository')
  const byComponent: Record<string, number> = {}
  const byRepositoryType: Record<string, number> = {}

  let initializedCount = 0
  let fallbackCount = 0
  let queryFailureCount = 0
  let writeFailureCount = 0

  for (const event of repositoryEvents) {
    const metadata = asRecord(event.metadata)
    incrementCounter(byComponent, metadata.component)
    incrementCounter(byRepositoryType, metadata.repositoryType)

    if (event.event === 'repository.initialized') initializedCount++
    if (event.event === 'repository.fallback-to-memory') fallbackCount++
    if (event.event === 'repository.query.failed') queryFailureCount++
    if (event.event === 'repository.write.failed') writeFailureCount++
  }

  return {
    totalRepositoryEvents: repositoryEvents.length,
    initializedCount,
    fallbackCount,
    queryFailureCount,
    writeFailureCount,
    byComponent,
    byRepositoryType,
  }
}


function extractOperationalFailureSummary(event: ObservedEventRecord): OperationalFailureSummary {
  const metadata = asRecord(event.metadata)
  const diagnostics = asRecord(metadata.diagnostics)
  const route = asRecord(diagnostics.route)
  const error = asRecord(metadata.error)

  return {
    event: event.event,
    kind: event.kind,
    status: event.status,
    timestamp: event.timestamp,
    summary: event.summary,
    providerId: asString(route.providerId) ?? asString(error.providerId),
    providerType: asString(route.providerType),
    model: asString(route.model),
    component: asString(metadata.component) ?? asString(getNested(metadata, ['metadata', 'component'])),
    repositoryType: asString(metadata.repositoryType) ?? asString(getNested(metadata, ['metadata', 'repositoryType'])),
    errorCode: asString(diagnostics.finalErrorCode) ?? asString(error.code),
  }
}

function createOperationalSnapshot(
  snapshot: ObservatorySnapshot,
  events: ObservedEventRecord[],
  gatewayAnalytics: GatewayAnalytics,
  repositoryAnalytics: RepositoryAnalytics,
  recentFailureLimit = 10
): OperationalSnapshot {
  const loadedComponents = new Set<string>()
  for (const event of events) {
    if (event.kind === 'gateway' && event.status === 'responded') loadedComponents.add('gateway')
    if (event.kind === 'repository' && event.event === 'repository.initialized') {
      const metadata = asRecord(event.metadata)
      const component = asString(metadata.component) ?? asString(getNested(metadata, ['metadata', 'component']))
      loadedComponents.add(component ?? 'repository')
    }
    if (event.kind === 'memory') loadedComponents.add('memory')
    if (event.kind === 'bond') loadedComponents.add('bond')
    if (event.kind === 'runtime') loadedComponents.add('runtime')
  }

  const recentFailures = events
    .filter((event) => event.status === 'failed' || event.event.endsWith('.failed'))
    .slice(-recentFailureLimit)
    .map(extractOperationalFailureSummary)

  return {
    since: snapshot.since,
    generatedAt: Date.now(),
    totalRecentEvents: snapshot.recentEvents.length,
    failureCount: snapshot.failureCount,
    loadedComponents: [...loadedComponents].sort(),
    gatewayAnalytics,
    repositoryAnalytics,
    recentFailures,
  }
}

function createSummary(event: string, payload: Record<string, unknown>): string {
  if (event === 'stimulus.received') {
    return `stimulus received: ${String(getNested(payload, ['stimulus', 'type']) ?? 'unknown')}`
  }
  if (event === 'behavior.selected') {
    return `behavior selected: ${String(payload.decision ?? 'unknown')}`
  }
  if (event === 'behavior.instruction') {
    const actions = getNested(payload, ['instruction', 'actions'])
    return `behavior instruction: ${Array.isArray(actions) ? actions.length : 0} action(s)`
  }
  if (event.startsWith('memory.')) {
    const entryId = getNested(payload, ['entry', 'id']) ?? getNested(payload, ['result', 'entry', 'id'])
    const count = getNested(payload, ['result', 'entries'])
    if (event === 'memory.retrieved' && Array.isArray(count)) {
      return `memory retrieved: ${count.length} entries`
    }
    return entryId ? `${event}: ${String(entryId)}` : event
  }
  if (event.startsWith('bond.')) {
    const bondId = getNested(payload, ['bond', 'id']) ?? getNested(payload, ['result', 'bond', 'id'])
    const bonds = getNested(payload, ['result', 'bonds'])
    if (event === 'bond.retrieved' && Array.isArray(bonds)) {
      return `bond retrieved: ${bonds.length} bonds`
    }
    return bondId ? `${event}: ${String(bondId)}` : event
  }
  if (event.startsWith('homeostasis.')) {
    const lifeId = getNested(payload, ['state', 'lifeInstanceId']) ?? getNested(payload, ['result', 'state', 'lifeInstanceId']) ?? getNested(payload, ['request', 'lifeId'])
    return lifeId ? `${event}: ${String(lifeId)}` : event
  }
  if (event.startsWith('dialogue.')) {
    const output = getNested(payload, ['result', 'output'])
    return typeof output === 'string'
      ? `${event}: ${output.length} chars`
      : event
  }
  if (event === 'brain.requested') {
    return `brain requested: ${String(getNested(payload, ['request', 'capability']) ?? 'unknown')}`
  }
  if (event === 'gateway.requested') {
    return `gateway requested: ${String(getNested(payload, ['request', 'model']) ?? 'default')}`
  }
  if (event === 'gateway.responded') {
    return `gateway responded: ${String(getNested(payload, ['response', 'finishReason']) ?? 'unknown')}`
  }
  if (event.startsWith('sender.') || event.startsWith('body.')) {
    const content = getNested(payload, ['task', 'content'])
    return typeof content === 'string' ? `${event}: ${content.length} chars` : event
  }
  return event
}

export class DefaultObservatoryService {
  private readonly store: ObservatoryStore

  constructor(maxRecords?: number) {
    this.store = new ObservatoryStore(maxRecords)
  }

  record(record: ObservedEventRecord): void {
    this.store.append(record)
  }

  recordEvent<K extends keyof CoreEventMap>(
    event: K | string,
    payload: CoreEventMap[K] | unknown
  ): ObservedEventRecord {
    const eventName = String(event)
    const payloadRecord = asRecord(payload)

    const record: ObservedEventRecord = {
      id: nextId(),
      kind: kindFromEvent(eventName),
      event: eventName,
      timestamp: Date.now(),
      stimulusId: extractStimulusId(eventName, payloadRecord),
      outputId: extractOutputId(payloadRecord),
      taskId: extractTaskId(payloadRecord),
      executionPlanId: extractExecutionPlanId(payloadRecord),
      executionActionId: extractExecutionActionId(payloadRecord),
      scheduledTaskId: extractTaskId(payloadRecord),
      memoryId: extractMemoryId(payloadRecord),
      memoryRequestId: eventName === 'behavior.memory.update.requested' || eventName.startsWith('memory.') ? extractRequestId(payloadRecord, 'memory') : undefined,
      bondId: extractBondId(payloadRecord),
      bondRequestId: eventName === 'behavior.bond.update.requested' || eventName.startsWith('bond.') ? extractRequestId(payloadRecord, 'bond') : undefined,
      bondTargetId: extractBondTargetId(payloadRecord),
      bondTargetType: extractBondTargetType(payloadRecord),
      homeostasisRequestId: eventName === 'behavior.homeostasis.update.requested' || eventName.startsWith('homeostasis.') ? extractRequestId(payloadRecord, 'homeostasis') : undefined,
      lifeId: extractLifeId(payloadRecord),
      habitatId: extractHabitatId(payloadRecord),
      scopeType: extractScopeType(payloadRecord),
      status: statusFromEvent(eventName),
      summary: createSummary(eventName, payloadRecord),
      metadata: sanitizePayload(payload),
    }

    this.record(record)
    return record
  }

  getRecentEvents(limit?: number): ObservedEventRecord[] {
    return this.store.getRecent(limit)
  }

  queryEvents(query?: ObservatoryQuery): ObservedEventRecord[] {
    return this.store.query(query)
  }

  getGatewayFailures(limit = 10): GatewayFailureRecord[] {
    return this.store.query({
      kind: 'gateway',
      event: 'gateway.failed',
      limit,
    }).map(extractGatewayFailureRecord)
  }

  getGatewayAnalytics(options: { recentFailureLimit?: number } = {}): GatewayAnalytics {
    const events = this.store.query({ limit: Number.MAX_SAFE_INTEGER })
    return createGatewayAnalytics(events, options.recentFailureLimit ?? 10)
  }

  getRepositoryAnalytics(): RepositoryAnalytics {
    const events = this.store.query({ limit: Number.MAX_SAFE_INTEGER })
    return createRepositoryAnalytics(events)
  }

  getStimulusTrace(stimulusId: string): StimulusTrace | undefined {
    return this.store.getTraceByStimulusId(stimulusId)
  }

  getSnapshot(recentLimit?: number): ObservatorySnapshot {
    return {
      ...this.store.createSnapshot(recentLimit),
      gatewayAnalytics: this.getGatewayAnalytics(),
      repositoryAnalytics: this.getRepositoryAnalytics(),
    }
  }


  getOperationalSnapshot(options: { recentLimit?: number, recentFailureLimit?: number } = {}): OperationalSnapshot {
    const snapshot = this.getSnapshot(options.recentLimit ?? 20)
    const events = this.store.query({ limit: Number.MAX_SAFE_INTEGER })
    return createOperationalSnapshot(
      snapshot,
      events,
      snapshot.gatewayAnalytics ?? this.getGatewayAnalytics(),
      snapshot.repositoryAnalytics ?? this.getRepositoryAnalytics(),
      options.recentFailureLimit ?? 10
    )
  }

  clear(): void {
    this.store.clear()
  }
}
