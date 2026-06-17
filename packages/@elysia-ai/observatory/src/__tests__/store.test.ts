import { describe, expect, it } from 'vitest'
import { ObservatoryStore } from '../store.js'
import type { ObservedEventRecord } from '../types.js'

function createRecord(
  id: string,
  stimulusId?: string,
  kind: ObservedEventRecord['kind'] = 'stimulus',
  status: ObservedEventRecord['status'] = 'received'
): ObservedEventRecord {
  return {
    id,
    kind,
    event: `${kind}.${status}`,
    timestamp: Date.now(),
    stimulusId,
    status,
    summary: id,
  }
}

describe('ObservatoryStore', () => {
  it('keeps only the latest records within maxRecords', () => {
    const store = new ObservatoryStore(2)

    store.append(createRecord('record-1', 'stimulus-1'))
    store.append(createRecord('record-2', 'stimulus-2'))
    store.append(createRecord('record-3', 'stimulus-3'))

    const recent = store.getRecent(10)
    expect(recent.map((record) => record.id)).toEqual(['record-2', 'record-3'])
    expect(store.getTraceByStimulusId('stimulus-1')).toBeUndefined()
    expect(store.getTraceByStimulusId('stimulus-2')?.events).toHaveLength(1)
  })

  it('groups records by stimulus id', () => {
    const store = new ObservatoryStore()

    store.append(createRecord('record-1', 'stimulus-1'))
    store.append(createRecord('record-2', 'stimulus-1', 'behavior', 'selected'))

    const trace = store.getTraceByStimulusId('stimulus-1')
    expect(trace?.stimulusId).toBe('stimulus-1')
    expect(trace?.events.map((event) => event.id)).toEqual(['record-1', 'record-2'])
  })

  it('creates snapshot statistics from retained records', () => {
    const store = new ObservatoryStore()

    store.append(createRecord('stimulus', 'stimulus-1'))
    store.append(createRecord('dialogue', 'stimulus-1', 'dialogue', 'completed'))
    store.append(createRecord('gateway', undefined, 'gateway', 'responded'))
    store.append(createRecord('failed', undefined, 'brain', 'failed'))

    const snapshot = store.createSnapshot()

    expect(snapshot.trackedStimulusCount).toBe(1)
    expect(snapshot.activeStimulusCount).toBe(1)
    expect(snapshot.dialogueCount).toBe(1)
    expect(snapshot.gatewayCount).toBe(1)
    expect(snapshot.failureCount).toBe(1)
    expect(snapshot.recentEvents).toHaveLength(4)
  })

  it('clears all records and resets trace state', () => {
    const store = new ObservatoryStore()

    store.append(createRecord('record-1', 'stimulus-1'))
    store.clear()

    expect(store.getRecent()).toEqual([])
    expect(store.getTraceByStimulusId('stimulus-1')).toBeUndefined()
    expect(store.createSnapshot().trackedStimulusCount).toBe(0)
  })
})
