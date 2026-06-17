import type { Context } from 'koishi'
import { getRequiredElysiaService, registerElysiaService } from './service-registry.js'

// ─────────────────────────────────────────────────
// Elysia 顶层插件工厂
//
// 收敛 elysia-ai-* 顶层 wrapper 中重复的 apply() 生命周期骨架：
//   1. 取 logger
//   2. 解析 runtime 服务（必需），缺失即记录并放弃
//   3. eventBus 门控：runtime.context.eventBus 不存在即放弃
//   4. 调用 build() 构造插件运行时；build 返回 undefined 则放弃
//      （build 内部完成额外依赖解析、附加门控、runtime 形状重塑）
//   5. 注册服务到 ctx（formal + legacy 别名）
//   6. dispose 时调用 handle.dispose()
//
// 仅服务于“标准” wrapper。带仓储工厂、命令注册、自定义事件接线的
// wrapper（memory/bond/model-gateway/observatory/body）保持显式实现。
// ─────────────────────────────────────────────────

export type ElysiaPluginLogger = ReturnType<Context['logger']>

export interface ElysiaPluginRuntimeHandle<TService> {
  service: TService
  dispose(): void
}

export interface ElysiaPluginBuildContext<TConfig, TRuntime> {
  ctx: Context
  runtime: TRuntime
  config: TConfig
  logger: ElysiaPluginLogger
}

export interface ElysiaPluginDescriptor<TConfig, TRuntime, TService> {
  /** 插件名，同时用作 logger 名与日志 plugin 字段。 */
  name: string
  /** 注册服务的正式名（如 'elysia.perception'）。 */
  serviceFormalName: string
  /** 注册服务的 legacy 别名（如 'elysia-ai-perception'）。 */
  serviceLegacyName?: string
  /** runtime 服务正式名，默认 'elysia.runtime'。 */
  runtimeFormalName?: string
  /** runtime 服务 legacy 别名，默认 'elysia-ai-runtime'。 */
  runtimeLegacyName?: string
  /** runtime 缺失时日志里的描述，默认 'runtime service'。 */
  runtimeDescription?: string
  /**
   * 构造插件运行时。在此完成额外依赖解析、附加门控（返回 undefined 即放弃注册）、
   * 以及 runtime 形状重塑。返回的 handle 至少需含 service 与 dispose。
   */
  build(
    context: ElysiaPluginBuildContext<TConfig, TRuntime>,
  ): ElysiaPluginRuntimeHandle<TService> | undefined
}

export function createElysiaPlugin<
  TConfig,
  TRuntime extends { context?: { eventBus?: unknown } },
  TService,
>(
  descriptor: ElysiaPluginDescriptor<TConfig, TRuntime, TService>,
): (ctx: Context, config: TConfig) => void {
  return (ctx, config) => {
    const logger = ctx.logger(descriptor.name)
    const runtime = getRequiredElysiaService<TRuntime>(ctx, {
      formalName: descriptor.runtimeFormalName ?? 'elysia.runtime',
      legacyName: descriptor.runtimeLegacyName ?? 'elysia-ai-runtime',
      logger,
      plugin: descriptor.name,
      description: descriptor.runtimeDescription ?? 'runtime service',
    })

    if (!runtime?.context?.eventBus) return

    const handle = descriptor.build({ ctx, runtime, config, logger })
    if (!handle) return

    registerElysiaService(ctx, {
      formalName: descriptor.serviceFormalName,
      legacyName: descriptor.serviceLegacyName,
      service: handle.service,
      logger,
      plugin: descriptor.name,
    })

    ctx.on('dispose', () => handle.dispose())
  }
}
