import type { Context } from 'koishi'

export interface ElysiaServiceLogger {
  debug?(message: string, meta?: Record<string, unknown>): void
  info?(message: string, meta?: Record<string, unknown>): void
  error?(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface RegisterElysiaServiceOptions<T> {
  formalName: string
  service: T
  logger?: ElysiaServiceLogger
  plugin?: string
}

export interface ElysiaServiceLookupOptions {
  formalName: string
  logger?: ElysiaServiceLogger
  plugin?: string
  phase?: string
  description?: string
}

/**
 * 通过 cordis 原生服务机制注册 Elysia 服务。
 *
 * `ctx.set()` 注册服务名（进 cordis 服务表，支持 `inject` 等待）。
 *
 * - 进 cordis 服务表 → 消费插件可用 `inject: ['elysia.xxx']` 声明依赖，
 *   cordis 会在服务就绪后再跑消费插件的 apply，根除"读早于写"的竞态。
 * - 用 `ctx.get()` 读取不会触发 "property is not registered" 警告。
 *
 * 销毁由 cordis 的 effect 机制托管：插件作用域 dispose 时自动把服务置空，
 * 调用方无需手动 dispose。
 */
export function registerElysiaService<T>(
  ctx: Context,
  options: RegisterElysiaServiceOptions<T>,
): void {
  const { formalName, service, logger, plugin } = options

  try {
    ctx.set(formalName, service)
  } catch {
    // 非空覆盖（如未正常 dispose 即重注册）：记录后跳过，避免抛错中断 apply
    logger?.debug?.('elysia service already registered, skipping re-registration', {
      plugin,
      serviceName: formalName,
    })
  }
}

export function getOptionalElysiaService<T>(
  ctx: Context,
  options: ElysiaServiceLookupOptions,
): T | undefined {
  // 用 cordis 官方访问器 ctx.get()，对未注册服务返回 undefined 而不触发警告
  return ctx.get(options.formalName) as T | undefined
}

/**
 * 查找一个被视为“必需”的 Elysia 服务。
 *
 * 命名中的 “Required” 表达的是**调用方语义**（这个依赖缺失就无法继续），
 * 而**不是返回值保证**：服务缺失时本函数不会抛错，而是记录一条 error 级日志
 * 并返回 `undefined`，由调用方决定如何降级（通常是 `if (!svc) return`）。
 *
 * 注意：对于“runtime 之类的基础依赖”，应优先在插件顶层声明
 * `export const inject = ['elysia.runtime']`，让 cordis 自动等待服务就绪，
 * 而不是依赖本函数的降级路径。本函数的降级契约主要用于可选依赖
 * （与 Phase 42 的 optional dependency degradation 一致）。
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
    },
  )
  return undefined
}
