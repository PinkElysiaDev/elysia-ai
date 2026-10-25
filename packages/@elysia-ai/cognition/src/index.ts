import type {
  CapabilityDiagnostics,
  CognitionService,
  CoreEventMap,
  EventBus,
  PipelineRunner,
  Stimulus,
  TriggerEvent,
} from '@elysia-ai/core'
import { BoundedCache } from '@elysia-ai/shared'
import { STAGE_COGNITION } from '@elysia-ai/core'
import {
  EventHistory,
  isEventEnabled,
  stimulusToTriggerEvent,
} from '@elysia-ai/trigger'

export const internalName = 'elysia-ai-cognition'

/**
 * cognition（事件注入层）配置：用户配置各类事件是否注入 events 变量。
 *
 * 两层开关语义：
 * - enabledEvents：接收开关——事件进不进历史（密度合并也依赖历史）；
 * - feed.include：呈现开关——事件在清单里对模型可不可见。
 */
export interface Config {
  events: {
    enabled: boolean
    enabledEvents?: Record<string, boolean>
    feed: {
      include?: Record<string, boolean>
      maxEvents: number
    }
    history: {
      maxEvents: number
      windowMs: number
    }
  }
}

export const DEFAULT_CONFIG: Config = {
  events: {
    enabled: true,
    feed: { maxEvents: 30 },
    history: { maxEvents: 100, windowMs: 30 * 60_000 },
  },
}

function scopeKey(lifeId: string, habitatId: string): string {
  return `${lifeId}:${habitatId}`
}

type CognitionLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface CognitionPluginRuntimeOptions {
  runtime: {
    /** cognition 以阶段钩子装配（单轨）；事件仅作事实通知。 */
    context: { eventBus: EventBus<CoreEventMap>, pipeline?: PipelineRunner<unknown> }
  }
  config: Config
  logger: CognitionLoggerLike
}

export interface CognitionPluginRuntime {
  service: CognitionService
  dispose(): void
}

export function createCognitionPluginRuntime(options: CognitionPluginRuntimeOptions): CognitionPluginRuntime {
  const { runtime, config, logger } = options

  logger.info('cognition plugin apply started', {
    plugin: 'elysia-ai-cognition',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const histories = new BoundedCache<string, EventHistory>(300)

  // 被过滤事件限频告警（60s/类型）：排查"静默丢事件"的关键观测（vtuber 经验）。
  const lastFilteredWarnAt = new Map<string, number>()
  const FILTERED_WARN_INTERVAL_MS = 60_000

  const getHistory = (lifeId: string, habitatId: string): EventHistory => {
    const key = scopeKey(lifeId, habitatId)
    const existing = histories.get(key)
    if (existing) return existing
    const created = new EventHistory({
      maxEvents: config.events.history.maxEvents,
      windowMs: config.events.history.windowMs,
    })
    histories.set(key, created)
    return created
  }

  const warnFiltered = (key: string, stimulusId: string): void => {
    const now = Date.now()
    const last = lastFilteredWarnAt.get(key) ?? 0
    if (now - last < FILTERED_WARN_INTERVAL_MS) return
    lastFilteredWarnAt.set(key, now)
    logger.warn?.(`event "${key}" filtered by enabledEvents config`, undefined, {
      plugin: 'elysia-ai-cognition',
      phase: 'ingest',
      eventKey: key,
      stimulusId,
    })
  }

  const service: CognitionService = {
    ingest(stimulus, lifeId) {
      if (!config.events.enabled) return null
      // 合成触发刺激（behavior 唤醒产物）不作为事件入账：它不是"世界发生的事"，
      // 且入账会造成自我循环（wake → mention 事件 → 再唤醒）。
      if (stimulus.metadata?.triggerSource) return null

      const event = stimulusToTriggerEvent(stimulus)
      if (!event) {
        logger.debug('stimulus produced no catalog event; skipping ingest', {
          plugin: 'elysia-ai-cognition',
          phase: 'ingest',
          stimulusId: stimulus.id,
          type: stimulus.type,
        })
        return null
      }
      if (!isEventEnabled(event.key, { enabledEvents: config.events.enabledEvents })) {
        warnFiltered(event.key, stimulus.id)
        return null
      }

      getHistory(lifeId, stimulus.habitatId).record(event)
      void eventBus.emit('cognition.event.recorded', {
        stimulusId: stimulus.id,
        lifeId,
        habitatId: stimulus.habitatId,
        event,
      })
      return event
    },

    buildFeed(lifeId, habitatId, feedOptions) {
      return getHistory(lifeId, habitatId).buildFeedLines({
        feedInclude: config.events.feed.include,
        maxEvents: feedOptions?.maxEvents ?? config.events.feed.maxEvents,
      })
    },

    getRecentEvents(lifeId, habitatId, limit) {
      return getHistory(lifeId, habitatId).recent(limit)
    },

    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-cognition',
        enabled: config.events.enabled,
        ready: true,
        serviceName: 'elysia.cognition',
        metadata: {
          trackedScopes: histories.size,
          feedMaxEvents: config.events.feed.maxEvents,
        },
      }
    },
  }

  // ── 装配：kernel 管线阶段钩子（主链单轨）──
  const pipeline = runtime.context.pipeline
  const disposers: Array<() => void> = []

  disposers.push(pipeline.registerHook({
    stage: STAGE_COGNITION,
    owner: 'elysia-ai-cognition',
    run(pctx) {
      const { stimulus, lifeId } = pctx.core as { stimulus: Stimulus, lifeId: string }
      service.ingest(stimulus, lifeId)
    },
  }))

  return {
    service,
    dispose() {
      for (const dispose of disposers) dispose()
      histories.clear()
      lastFilteredWarnAt.clear()
      logger.info('cognition plugin disposed', {
        plugin: 'elysia-ai-cognition',
        phase: 'dispose',
      })
    },
  }
}
