import { Context } from 'koishi'

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export function createPluginLogger(ctx: Context, pluginName: string): PluginLogger {
  const logger = ctx.logger(pluginName)

  return {
    info(message: string, meta?: Record<string, unknown>) {
      logger.info(message, meta)
    },
    debug(message: string, meta?: Record<string, unknown>) {
      logger.debug(message, meta)
    },
    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
      if (meta && error) {
        logger.error(message, meta, error)
        return
      }
      if (error) {
        logger.error(message, error)
        return
      }
      if (meta) {
        logger.error(message, meta)
        return
      }
      logger.error(message)
    },
  }
}
