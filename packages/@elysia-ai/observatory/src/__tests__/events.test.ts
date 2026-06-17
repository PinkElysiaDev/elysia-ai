import { describe, expect, it } from 'vitest'
import { MemoryEventBus } from '@elysia-ai/core'
import type { CoreEventMap } from '@elysia-ai/core'
import { createObservatoryPluginRuntime } from '../index.js'

function createRuntime(eventBus: MemoryEventBus<CoreEventMap>) {
  return {
    context: {
      eventBus,
    },
  }
}

const logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}

describe('elysia-ai-observatory events', () => {
  it('records runtime and life events from the runtime event bus', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const observatoryRuntime = createObservatoryPluginRuntime({ runtime: createRuntime(eventBus), config: { maxRecords: 20 }, logger })

    await eventBus.emit('runtime.starting', { timestamp: 1 })
    await eventBus.emit('runtime.started', { timestamp: 2 })
    await eventBus.emit('life.loaded', {
      lifeId: 'life-1',
      type: 'default',
      config: { id: 'life-1' },
    })

    const events = observatoryRuntime?.service.service.getRecentEvents() ?? []

    expect(events.map((event: any) => event.event)).toEqual([
      'runtime.starting',
      'runtime.started',
      'life.loaded',
    ])
    expect(events[2].lifeId).toBe('life-1')
    expect(events[2].metadata.type).toBe('default')
  })

  it('records stimulus, behavior and dialogue events under the same stimulus trace', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const observatoryRuntime = createObservatoryPluginRuntime({ runtime: createRuntime(eventBus), config: { maxRecords: 20 }, logger })

    await eventBus.emit('stimulus.received', {
      stimulusId: 'stimulus-1',
      stimulus: {
        id: 'stimulus-1',
        type: 'utterance',
        habitatId: 'habitat-1',
        actorId: 'user-1',
        timestamp: Date.now(),
        payload: { content: 'hello' },
      },
    })

    await eventBus.emit('behavior.selected', {
      stimulusId: 'stimulus-1',
      scope: { type: 'user', key: 'user-1' },
      decision: 'send-to-ai',
      plan: {
        scope: { type: 'user', key: 'user-1' },
        sourceStimulusIds: ['stimulus-1'],
        mode: 'send-to-ai',
        plannerSource: 'program',
        shouldEnterDialogue: true,
        shouldUpdateMemory: true,
        shouldUpdateBond: true,
        shouldUpdateHomeostasis: true,
        shouldScheduleFollowup: false,
        reason: 'test',
      },
      signal: {
        directness: 1,
        continuity: 0,
        bondAffinity: 0,
        bufferPressure: 0,
        responseNecessity: 1,
        structuralDeterminability: 1,
      },
    })

    const task: any = {
      sourceStimulusIds: ['stimulus-1'],
      scope: { type: 'user', key: 'user-1' },
      mode: 'send-to-ai',
      messages: [],
      metadata: {},
    }

    await eventBus.emit('dialogue.completed', {
      task,
      result: {
        taskId: 'stimulus-1',
        output: 'hello',
        messages: [],
        metadata: {},
      },
    })

    const trace = observatoryRuntime?.service.service.getStimulusTrace('stimulus-1')

    expect(trace?.events.map((event: any) => event.event)).toEqual([
      'stimulus.received',
      'behavior.selected',
      'dialogue.completed',
    ])
  })
})
