import type { EventBus } from './event-bus.js'

type EventHandler<Payload> = (payload: Payload) => void | Promise<void>

function debugLog(message: string, meta?: Record<string, any>) {
  if (meta) {
    console.debug(`[elysia-ai-core:event-bus] ${message}`, meta)
    return
  }

  console.debug(`[elysia-ai-core:event-bus] ${message}`)
}

function errorLog(message: string, error: unknown, meta?: Record<string, any>) {
  if (meta) {
    console.error(`[elysia-ai-core:event-bus] ${message}`, meta, error)
    return
  }

  console.error(`[elysia-ai-core:event-bus] ${message}`, error)
}

export class MemoryEventBus<EventMap extends object>
  implements EventBus<EventMap>
{
  private handlers = new Map<keyof EventMap, Set<EventHandler<any>>>()

  async emit<K extends keyof EventMap>(
    event: K,
    payload: EventMap[K]
  ): Promise<void> {
    const handlers = this.handlers.get(event)

    if (!handlers || handlers.size === 0) {
      debugLog('event emitted without listeners', {
        plugin: 'elysia-ai-core',
        phase: 'event-bus',
        event: String(event),
      })
      return
    }

    debugLog('event emitted', {
      plugin: 'elysia-ai-core',
      phase: 'event-bus',
      event: String(event),
      listenerCount: handlers.size,
    })

    for (const handler of Array.from(handlers)) {
      try {
        await handler(payload)
      } catch (error) {
        // Listener 隔离：单个 listener 失败不得中断其他 listener，也不向 emit 调用方重抛。
        // 事件总线是多订阅者的，一个观测/感知 listener 抛错若中止整条链路或冒泡回
        // 发布方，会让无关订阅者（behavior / cognition / observatory）静默丢事件。
        // 失败在此记录，其余 listener 继续执行。
        errorLog('event handler execution failed', error, {
          plugin: 'elysia-ai-core',
          phase: 'event-bus',
          event: String(event),
        })
      }
    }
  }

  on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>
  ): () => void {
    const handlers = this.handlers.get(event) ?? new Set<EventHandler<any>>()

    handlers.add(handler)
    this.handlers.set(event, handlers)

    debugLog('event listener registered', {
      plugin: 'elysia-ai-core',
      phase: 'event-bus',
      event: String(event),
      listenerCount: handlers.size,
    })

    return () => {
      handlers.delete(handler)

      if (handlers.size === 0) {
        this.handlers.delete(event)
        debugLog('event listener removed and event cleared', {
          plugin: 'elysia-ai-core',
          phase: 'event-bus',
          event: String(event),
          listenerCount: 0,
        })
        return
      }

      debugLog('event listener removed', {
        plugin: 'elysia-ai-core',
        phase: 'event-bus',
        event: String(event),
        listenerCount: handlers.size,
      })
    }
  }

  once<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>
  ): () => void {
    let dispose: (() => void) | undefined

    const wrappedHandler: EventHandler<EventMap[K]> = async (payload) => {
      dispose?.()
      await handler(payload)
    }

    dispose = this.on(event, wrappedHandler)

    debugLog('one-time event listener registered', {
      plugin: 'elysia-ai-core',
      phase: 'event-bus',
      event: String(event),
    })

    return dispose
  }
}
