import type { ObservedEventRecord, ObservatoryQuery, StimulusTrace, ObservatorySnapshot } from './types.js'

const DEFAULT_MAX_RECORDS = 500

function getNestedValues(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) return [value]
  if (Array.isArray(value)) {
    return value.flatMap((item) => getNestedValues(item, path))
  }
  if (typeof value !== 'object' || value === null) return []

  const [key, ...rest] = path
  return getNestedValues((value as Record<string, unknown>)[key], rest)
}

function findInMetadata(metadata: Record<string, unknown> | undefined, paths: string[][]): string[] {
  const matches: string[] = []
  for (const path of paths) {
    for (const value of getNestedValues(metadata, path)) {
      if (typeof value === 'string' && value.length > 0) {
        matches.push(value)
      }
    }
  }
  return matches
}

export class ObservatoryStore {
  private records: ObservedEventRecord[] = []
  private byStimulus: Map<string, ObservedEventRecord[]> = new Map()
  private readonly maxRecords: number
  private createdAt: number

  constructor(maxRecords = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords
    this.createdAt = Date.now()
  }

  append(record: ObservedEventRecord): void {
    this.records.push(record)

    if (record.stimulusId) {
      const list = this.byStimulus.get(record.stimulusId) ?? []
      list.push(record)
      this.byStimulus.set(record.stimulusId, list)
    }

    if (this.records.length > this.maxRecords) {
      const removed = this.records.shift()
      if (removed?.stimulusId) {
        const list = this.byStimulus.get(removed.stimulusId)
        if (list) {
          list.shift()
          if (list.length === 0) {
            this.byStimulus.delete(removed.stimulusId)
          }
        }
      }
    }
  }

  getRecent(limit = 50): ObservedEventRecord[] {
    return this.records.slice(-limit)
  }

  query(query: ObservatoryQuery = {}): ObservedEventRecord[] {
    const limit = query.limit ?? 50
    const matched = this.records.filter((record) => {
      if (query.kind && record.kind !== query.kind) return false
      if (query.event && record.event !== query.event) return false
      if (query.status && record.status !== query.status) return false
      if (query.stimulusId && record.stimulusId !== query.stimulusId) return false
      if (query.taskId && record.taskId !== query.taskId) return false

      if (query.component) {
        const component = findInMetadata(record.metadata, [
          ['component'],
          ['metadata', 'component'],
        ])
        if (!component.includes(query.component)) return false
      }
      if (query.since !== undefined && record.timestamp < query.since) return false
      if (query.until !== undefined && record.timestamp > query.until) return false

      if (query.providerId) {
        const providerId = findInMetadata(record.metadata, [
          ['diagnostics', 'route', 'providerId'],
          ['diagnostics', 'attempts', 'providerId'],
          ['response', 'provider', 'id'],
          ['error', 'providerId'],
        ])
        if (!providerId.includes(query.providerId)) return false
      }

      if (query.repositoryType) {
        const repositoryType = findInMetadata(record.metadata, [
          ['repositoryType'],
          ['metadata', 'repositoryType'],
        ])
        if (!repositoryType.includes(query.repositoryType)) return false
      }

      if (query.errorCode) {
        const errorCode = findInMetadata(record.metadata, [
          ['diagnostics', 'finalErrorCode'],
          ['diagnostics', 'attempts', 'errorCode'],
          ['error', 'code'],
        ])
        if (!errorCode.includes(query.errorCode)) return false
      }

      return true
    })

    return matched.slice(-limit)
  }

  getTraceByStimulusId(stimulusId: string): StimulusTrace | undefined {
    const events = this.byStimulus.get(stimulusId)
    if (!events || events.length === 0) return undefined
    return { stimulusId, events: [...events] }
  }

  createSnapshot(recentLimit = 20): ObservatorySnapshot {
    const recentEvents = this.getRecent(recentLimit)

    let dialogueCount = 0
    let gatewayCount = 0
    let failureCount = 0

    for (const record of this.records) {
      if (record.kind === 'dialogue' && record.status === 'completed') dialogueCount++
      if (record.kind === 'gateway' && record.status === 'responded') gatewayCount++
      if (record.status === 'failed') failureCount++
    }

    const trackedStimulusCount = this.byStimulus.size

    return {
      recentEvents,
      activeStimulusCount: trackedStimulusCount,
      trackedStimulusCount,
      dialogueCount,
      gatewayCount,
      failureCount,
      since: this.createdAt,
    }
  }

  clear(): void {
    this.records = []
    this.byStimulus.clear()
    this.createdAt = Date.now()
  }
}
