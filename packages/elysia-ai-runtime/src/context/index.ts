import type { EventBus } from '@elysia-ai/core'
import type { CoreEventMap } from '@elysia-ai/core'

export interface RuntimeLogger {
  info(message: string, meta?: Record<string, any>): void
  debug(message: string, meta?: Record<string, any>): void
  error(message: string, error?: unknown, meta?: Record<string, any>): void
}

export interface RuntimeContext {
  eventBus: EventBus<CoreEventMap>
  logger: RuntimeLogger
}
