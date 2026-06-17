import type { CapabilityDiagnostics, CoreEventMap, EventBus, ObservatoryServiceFacade } from '@elysia-ai/core'
import type { ObservedEventKind, ObservedEventRecord, ObservedEventStatus } from './types.js'
import { DefaultObservatoryService } from './service.js'

export const internalName = 'elysia-ai-observatory'

type ObservatoryLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface Config {
  enabled?: boolean
  maxRecords?: number
}

const OBSERVED_EVENTS: Array<keyof CoreEventMap> = [
  'runtime.starting',
  'runtime.started',
  'runtime.stopping',
  'runtime.stopped',

  'life.loaded',

  'stimulus.received',
  'projection.routed',
  'perception.completed',
  'homeostasis.updated',

  'cognition.reasoning',
  'cognition.completed',

  'behavior.candidates.generated',
  'behavior.selected',
  'behavior.instruction',
  'behavior.execution.plan.created',
  'behavior.execution.started',
  'behavior.execution.action.started',
  'behavior.execution.action.completed',
  'behavior.execution.action.failed',
  'behavior.execution.completed',
  'behavior.execution.failed',
  'behavior.followup.scheduled',
  'behavior.memory.update.requested',
  'behavior.bond.update.requested',
  'behavior.homeostasis.update.requested',

  'memory.created',
  'memory.updated',
  'memory.update.failed',
  'memory.retrieved',
  'memory.retrieve.failed',
  'memory.consolidation.requested',
  'memory.consolidated',
  'memory.consolidation.failed',

  'scheduler.task.created',
  'scheduler.task.started',
  'scheduler.task.completed',
  'scheduler.task.failed',
  'scheduler.task.cancelled',
  'scheduler.task.expired',

  'dialogue.task.created',
  'dialogue.generation.requested',
  'dialogue.started',
  'dialogue.generated',
  'dialogue.output.created',
  'dialogue.completed',
  'dialogue.failed',

  'brain.requested',
  'brain.completed',
  'brain.failed',

  'gateway.requested',
  'gateway.responded',
  'gateway.failed',

  'repository.initialized',
  'repository.query.failed',
  'repository.write.failed',
  'repository.fallback-to-memory',

  'sender.started',
  'sender.completed',
  'sender.failed',
  'body.message.sent',
  'body.message.failed',
]

function registerObserverListeners(
  eventBus: EventBus<CoreEventMap>,
  service: DefaultObservatoryService,
  logger: ObservatoryLoggerLike
): Array<() => void> {
  const bus = eventBus as any
  const disposers: Array<() => void> = []

  for (const eventName of OBSERVED_EVENTS) {
    const dispose = bus.on(eventName, (payload: unknown) => {
      try {
        service.recordEvent(eventName, payload)
      } catch (error) {
        logger.error('observatory failed to record event', error, {
          plugin: 'elysia-ai-observatory',
          phase: 'record',
          event: eventName,
        })
      }
    })

    disposers.push(dispose)
  }

  return disposers
}

export interface ObservatoryPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> } }
  config: Config
  logger: ObservatoryLoggerLike
}

export interface ObservatoryPluginRuntime {
  service: ObservatoryServiceFacade & { service: DefaultObservatoryService }
  dispose(): void
}

export function createObservatoryPluginRuntime(options: ObservatoryPluginRuntimeOptions): ObservatoryPluginRuntime | undefined {
  const { runtime, config, logger } = options
  const maxRecords = config.maxRecords ?? 500

  logger.info('observatory plugin apply started', {
    plugin: 'elysia-ai-observatory',
    phase: 'apply',
    enabled: config.enabled !== false,
    maxRecords,
  })

  if (config.enabled === false) {
    logger.info('observatory plugin disabled by config', {
      plugin: 'elysia-ai-observatory',
      phase: 'apply',
    })
    return undefined
  }

  const eventBus = runtime.context.eventBus
  const service = new DefaultObservatoryService(maxRecords)
  const disposers = registerObserverListeners(eventBus, service, logger)

  const observatoryService: ObservatoryServiceFacade & { service: DefaultObservatoryService } = {
    service,
    recordEvent(eventName, payload) { service.recordEvent(eventName, payload) },
    queryEvents(query) { return service.queryEvents(query as any) },
    getSnapshot() { return service.getSnapshot() },
    getOperationalSnapshot() { return service.getOperationalSnapshot() },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-observatory',
        enabled: config.enabled !== false,
        ready: true,
        serviceName: 'elysia.observatory',
        metadata: { maxRecords, listenersRegistered: disposers.length },
      }
    },
  }

  logger.info('observatory plugin ready', {
    plugin: 'elysia-ai-observatory',
    phase: 'apply',
    maxRecords,
    listenersRegistered: disposers.length,
  })

  return {
    service: observatoryService,
    dispose() {
      for (const dispose of disposers) dispose()
      logger.info('observatory plugin disposed', {
        plugin: 'elysia-ai-observatory',
        phase: 'dispose',
        listenersDisposed: disposers.length,
      })
    },
  }
}

export type { ObservedEventRecord, ObservedEventKind, ObservedEventStatus } from './types.js'
export type { StimulusTrace, ObservatorySnapshot, OperationalSnapshot, OperationalFailureSummary } from './types.js'
export { DefaultObservatoryService } from './service.js'
export { ObservatoryStore } from './store.js'
