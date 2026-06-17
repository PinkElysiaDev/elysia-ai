import { Schema, type Context } from 'koishi'
import { createObservatoryPluginRuntime } from '@elysia-ai/observatory'
import type { Config as ObservatoryConfig } from '@elysia-ai/observatory'
import type { CoreEventMap, EventBus } from '@elysia-ai/core'
import { combinePreflightResults, createPreflightResult, getOptionalElysiaService, getRequiredElysiaService, issue, registerElysiaService, type PreflightResult } from '@elysia-ai/shared'
export * from '@elysia-ai/observatory'

export const name = 'elysia-ai-observatory'

export const Config: Schema<ObservatoryConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用观测台（采集主链事件与诊断）。'),
  maxRecords: Schema.number().default(500).description('内存中保留的最大事件记录条数。'),
})


type CommandLike = {
  action(handler: (...args: unknown[]) => unknown): unknown
}

type DiagnosticsLike = {
  getDiagnostics?: () => { ready?: boolean, serviceName?: string, metadata?: Record<string, unknown> }
}

type ObservatoryLike = DiagnosticsLike & {
  getSnapshot?: () => unknown
  getOperationalSnapshot?: () => unknown
  service?: { getOperationalSnapshot?: () => unknown, getRepositoryAnalytics?: () => unknown, getGatewayAnalytics?: () => unknown }
}

function getService<T>(ctx: Context, formalName: string, legacyName?: string): T | undefined {
  return getOptionalElysiaService<T>(ctx, { formalName, legacyName })
}

function formatLoadedStatus(ctx: Context): string {
  const services = [
    ['runtime', 'elysia.runtime', 'elysia-ai-runtime'],
    ['modelGateway', 'elysia.modelGateway', 'elysia-ai-model-gateway'],
    ['brain', 'elysia.brain', 'elysia-ai-brain'],
    ['dialogue', 'elysia.dialogue', 'elysia-ai-dialogue'],
    ['behavior', 'elysia.behavior', 'elysia-ai-behavior'],
    ['memory', 'elysia.memory', 'elysia-ai-memory'],
    ['bond', 'elysia.bond', 'elysia-ai-bond'],
    ['perception', 'elysia.perception', 'elysia-ai-perception'],
    ['cognition', 'elysia.cognition', 'elysia-ai-cognition'],
    ['homeostasis', 'elysia.homeostasis', 'elysia-ai-homeostasis'],
    ['persona', 'elysia.persona', 'elysia-ai-persona'],
    ['observatory', 'elysia.observatory', 'elysia-ai-observatory'],
    ['body', 'elysia.body', 'elysia-ai-body'],
  ] as const

  const lines = ['Elysia A.I. Status']
  let loadedCount = 0
  for (const [label, formalName, legacyName] of services) {
    const service = getService<DiagnosticsLike>(ctx, formalName, legacyName)
    if (service) loadedCount++
    const diagnostics = service?.getDiagnostics?.()
    const ready = diagnostics?.ready === undefined ? Boolean(service) : diagnostics.ready
    lines.push(`- ${label}: ${service ? 'loaded' : 'not loaded'}${service ? `, ready: ${ready}` : ''}`)
  }

  const observatory = getService<ObservatoryLike>(ctx, 'elysia.observatory', 'elysia-ai-observatory')
  const snapshot = observatory?.getOperationalSnapshot?.() ?? observatory?.service?.getOperationalSnapshot?.()
  const failureCount = typeof snapshot === 'object' && snapshot && 'failureCount' in snapshot ? (snapshot as any).failureCount : 0
  lines.splice(1, 0, `loadedServices: ${loadedCount}/${services.length}`, `recentFailures: ${failureCount}`)
  return lines.join('\n')
}

function formatGatewayStatus(ctx: Context): string {
  const gateway = getService<any>(ctx, 'elysia.modelGateway', 'elysia-ai-model-gateway')
  if (!gateway) return 'Model gateway service not loaded.'

  const registry = typeof gateway.getRegistry === 'function' ? gateway.getRegistry() : undefined
  const providers = typeof registry?.getAll === 'function' ? registry.getAll() : []
  const healthSnapshots = typeof gateway.getHealthSnapshots === 'function' ? gateway.getHealthSnapshots() : []
  const lines = ['Elysia Gateway Status', `providers: ${providers.length}`, `healthSnapshots: ${healthSnapshots.length}`]
  for (const provider of providers) {
    const descriptor = typeof provider?.getDescriptor === 'function' ? provider.getDescriptor() : provider?.descriptor ?? provider
    lines.push(`- ${descriptor?.id ?? 'unknown'}: type=${descriptor?.type ?? 'unknown'}, model=${descriptor?.model ?? 'unknown'}`)
  }
  return lines.join('\n')
}

function formatRepositoryStatus(ctx: Context): string {
  const observatory = getService<ObservatoryLike>(ctx, 'elysia.observatory', 'elysia-ai-observatory')
  const analytics = observatory?.service?.getRepositoryAnalytics?.() ?? (observatory?.getOperationalSnapshot?.() as any)?.repositoryAnalytics
  if (!analytics) return 'Repository analytics not loaded. Please enable elysia-ai-observatory.'

  return [
    'Elysia Repository Status',
    `events: ${analytics.totalRepositoryEvents ?? 0}`,
    `initialized: ${analytics.initializedCount ?? 0}`,
    `fallbackToMemory: ${analytics.fallbackCount ?? 0}`,
    `queryFailures: ${analytics.queryFailureCount ?? 0}`,
    `writeFailures: ${analytics.writeFailureCount ?? 0}`,
    `byComponent: ${JSON.stringify(analytics.byComponent ?? {})}`,
    `byRepositoryType: ${JSON.stringify(analytics.byRepositoryType ?? {})}`,
  ].join('\n')
}

export function runElysiaPreflight(configs: {
  modelGateway?: { preflight?: () => PreflightResult }
  memory?: { preflight?: () => PreflightResult }
  bond?: { preflight?: () => PreflightResult }
} = {}): PreflightResult {
  const results = [configs.modelGateway?.preflight?.(), configs.memory?.preflight?.(), configs.bond?.preflight?.()].filter(Boolean) as PreflightResult[]
  if (results.length === 0) {
    return createPreflightResult([
      issue('elysia-ai-observatory', 'preflight.no-config', 'warning', 'No static config payload was provided; loaded service status can still be inspected with elysia.status.'),
    ], { plugin: 'elysia-ai-observatory' })
  }
  return combinePreflightResults(results)
}

function formatPreflightResult(result: PreflightResult): string {
  const lines = [`Elysia Preflight: ${result.ok ? 'ok' : 'failed'}`]
  for (const error of result.errors) lines.push(`- error ${error.plugin}/${error.code}: ${error.message}`)
  for (const warning of result.warnings) lines.push(`- warning ${warning.plugin}/${warning.code}: ${warning.message}`)
  return lines.join('\n')
}

function registerOperationalCommands(ctx: Context) {
  const command = (ctx as unknown as { command?: (...args: unknown[]) => CommandLike }).command
  if (typeof command !== 'function') return

  command.call(ctx, 'elysia.status', 'Elysia A.I. operational status', { authority: 3 })
    .action(() => formatLoadedStatus(ctx))

  command.call(ctx, 'elysia.gateway.status', 'Elysia A.I. model gateway status', { authority: 3 })
    .action(() => formatGatewayStatus(ctx))

  command.call(ctx, 'elysia.repository.status', 'Elysia A.I. repository status', { authority: 3 })
    .action(() => formatRepositoryStatus(ctx))

  command.call(ctx, 'elysia.preflight', 'Elysia A.I. config preflight', { authority: 4 })
    .action((_argv: unknown, configs?: Parameters<typeof runElysiaPreflight>[0]) => formatPreflightResult(runElysiaPreflight(configs)))
}

export function apply(ctx: Context, config: ObservatoryConfig) {
  const logger = ctx.logger('elysia-ai-observatory')
  const runtime = getRequiredElysiaService<{ context: { eventBus: EventBus<CoreEventMap> } }>(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    logger,
    plugin: 'elysia-ai-observatory',
    description: 'runtime event bus',
  })

  if (!runtime?.context?.eventBus) return

  const observatoryRuntime = createObservatoryPluginRuntime({ runtime, config, logger })
  if (!observatoryRuntime) return

  registerElysiaService(ctx, {
    formalName: 'elysia.observatory',
    legacyName: 'elysia-ai-observatory',
    service: observatoryRuntime.service,
    logger,
    plugin: 'elysia-ai-observatory',
  })

  registerOperationalCommands(ctx)

  ctx.on('dispose', () => observatoryRuntime.dispose())
}
