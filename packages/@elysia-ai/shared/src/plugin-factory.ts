import type { Context } from 'koishi'
import type { KernelPluginManifest } from '@elysia-ai/core'
import { getRequiredElysiaService, registerElysiaService } from './service-registry.js'

// ─────────────────────────────────────────────────
// Elysia 顶层插件工厂 v2
//
// 收敛 elysia-ai-* 顶层 wrapper 中重复的 apply() 生命周期骨架：
//   1. 取 logger
//   2. 解析 runtime 服务（必需），缺失即记录并放弃
//   3. eventBus 门控：runtime.context.eventBus 不存在即放弃
//   4. 注册插件 manifest（可选）到 runtime 的 manifest 注册表——
//      runtime.start() 时统一做依赖/版本/命名空间兼容校验（告警式）
//   5. 调用 build() 构造插件运行时；build 返回 undefined 则放弃
//      （build 内部完成额外依赖解析、附加门控）
//   6. 注册服务到 ctx（cordis 服务表，单名）
//   7. dispose 时调用 handle.dispose() 并注销 manifest
//
// 仅服务于“标准”wrapper。带仓储工厂、命令注册、自定义事件接线的
// wrapper（memory/bond/model-gateway/observatory/body）保持显式实现
// （但同样推荐注册 manifest 以纳入兼容治理）。
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
  /** runtime 服务正式名，默认 'elysia.runtime'。 */
  runtimeFormalName?: string
  /** runtime 缺失时日志里的描述，默认 'runtime service'。 */
  runtimeDescription?: string
  /**
   * 插件 manifest（kernel 兼容治理）。提供时自动注册到
   * runtime.context.manifests，runtime.start() 统一校验
   * 依赖存在性 / frameworkApiVersion / configNamespace 冲突（告警式）。
   */
  manifest?: KernelPluginManifest
  /**
   * 构造插件运行时。在此完成额外依赖解析、附加门控（返回 undefined 即放弃注册）、
   * 以及 runtime 形状重塑。返回的 handle 至少需含 service 与 dispose。
   *
   * 注意：本工厂不负责声明 cordis `inject`。wrapper 模块若需让 cordis
   * 等待基础服务（如 elysia.runtime / elysia.modelGateway / elysia.brain）就绪
   * 再跑 apply，应在模块顶层另写 `export const inject = [...]`（cordis 从
   * 模块命名空间读 `plugin['inject']`，而非 apply 函数的静态属性）。
   */
  build(
    context: ElysiaPluginBuildContext<TConfig, TRuntime>,
  ): ElysiaPluginRuntimeHandle<TService> | undefined
}

export function createElysiaPlugin<
  TConfig,
  TRuntime extends { context?: { eventBus?: unknown, manifests?: { register(manifest: KernelPluginManifest): () => void } } },
  TService,
>(
  descriptor: ElysiaPluginDescriptor<TConfig, TRuntime, TService>,
): (ctx: Context, config: TConfig) => void {
  return (ctx, config) => {
    const logger = ctx.logger(descriptor.name)
    const runtime = getRequiredElysiaService<TRuntime>(ctx, {
      formalName: descriptor.runtimeFormalName ?? 'elysia.runtime',
      logger,
      plugin: descriptor.name,
      description: descriptor.runtimeDescription ?? 'runtime service',
    })

    if (!runtime?.context?.eventBus) return

    // manifest 注册（可选）：纳入 runtime.start() 的兼容治理。
    const unregisterManifest = descriptor.manifest
      ? runtime.context.manifests?.register(descriptor.manifest)
      : undefined

    const handle = descriptor.build({ ctx, runtime, config, logger })
    if (!handle) {
      unregisterManifest?.()
      return
    }

    registerElysiaService(ctx, {
      formalName: descriptor.serviceFormalName,
      service: handle.service,
      logger,
      plugin: descriptor.name,
    })

    // 服务销毁由 cordis effect 托管；这里只负责非 cordis 运行环境（测试 fake
    // context 等）的 dispose 兜底与 manifest 注销。
    ctx.on('dispose', () => {
      unregisterManifest?.()
      handle.dispose()
    })
  }
}
