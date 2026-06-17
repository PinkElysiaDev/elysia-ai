import type { Context } from 'koishi'

export interface ElysiaServiceLogger {
  debug?(message: string, meta?: Record<string, unknown>): void
  info?(message: string, meta?: Record<string, unknown>): void
  error?(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface RegisterElysiaServiceOptions<T> {
  formalName: string
  legacyName?: string
  service: T
  logger?: ElysiaServiceLogger
  plugin?: string
}

export interface ElysiaServiceLookupOptions {
  formalName: string
  legacyName?: string
  logger?: ElysiaServiceLogger
  plugin?: string
  phase?: string
  description?: string
}

function getContextValue<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as Record<string, T | undefined>)[name]
}

function setContextValue<T>(ctx: Context, name: string, value: T | undefined): void {
  ;(ctx as unknown as Record<string, T | undefined>)[name] = value
}

export function registerElysiaService<T>(
  ctx: Context,
  options: RegisterElysiaServiceOptions<T>,
): () => void {
  const { formalName, legacyName, service, logger, plugin } = options
  const previousFormal = getContextValue<T>(ctx, formalName)
  const previousLegacy = legacyName ? getContextValue<T>(ctx, legacyName) : undefined

  if (previousFormal && previousFormal !== service) {
    logger?.debug?.('elysia service formal alias overwritten', { plugin, serviceName: formalName })
  }
  if (legacyName && previousLegacy && previousLegacy !== service) {
    logger?.debug?.('elysia service legacy alias overwritten', { plugin, serviceName: legacyName })
  }

  setContextValue(ctx, formalName, service)
  if (legacyName) setContextValue(ctx, legacyName, service)

  const dispose = () => {
    if (getContextValue(ctx, formalName) === service) setContextValue(ctx, formalName, undefined)
    if (legacyName && getContextValue(ctx, legacyName) === service) setContextValue(ctx, legacyName, undefined)
  }

  if (typeof (ctx as unknown as { on?: unknown }).on === 'function') {
    ctx.on('dispose', dispose)
  }
  return dispose
}

export function getOptionalElysiaService<T>(
  ctx: Context,
  options: ElysiaServiceLookupOptions,
): T | undefined {
  const formal = getContextValue<T>(ctx, options.formalName)
  if (formal) return formal
  if (options.legacyName) return getContextValue<T>(ctx, options.legacyName)
  return undefined
}

/**
 * 查找一个被视为“必需”的 Elysia 服务。
 *
 * 命名中的 “Required” 表达的是**调用方语义**（这个依赖缺失就无法继续），
 * 而**不是返回值保证**：服务缺失时本函数不会抛错，而是记录一条 error 级日志
 * 并返回 `undefined`，由调用方决定如何降级（通常是 `if (!svc) return`）。
 * 这一“记录缺失并降级”的契约与 Phase 42 的 optional dependency degradation 一致，
 * 不应改为抛错——多个插件依赖该行为做优雅降级。
 *
 * @returns 命中的服务实例；缺失时为 `undefined`（已记录 error 日志）。
 */
export function getRequiredElysiaService<T>(
  ctx: Context,
  options: ElysiaServiceLookupOptions,
): T | undefined {
  const service = getOptionalElysiaService<T>(ctx, options)
  if (service) return service

  options.logger?.error?.(
    `${options.description ?? options.formalName} not found; plugin cannot continue`,
    undefined,
    {
      plugin: options.plugin,
      phase: options.phase ?? 'apply',
      formalName: options.formalName,
      legacyName: options.legacyName,
    },
  )
  return undefined
}
