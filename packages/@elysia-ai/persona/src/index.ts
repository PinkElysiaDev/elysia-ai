import type { CoreEventMap, EventBus, Persona, PersonaRegistry, PersonaService } from '@elysia-ai/core'

export const internalName = 'elysia-ai-persona'

export interface Config {
  defaultName: string
  defaultSystemPrompt: string
  defaultTone: string
  registerDefaultPersona: boolean
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Persona 瑙ｆ瀽
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function resolvePersonaFromLifeConfig(
  lifeId: string,
  manifestConfig: unknown,
  defaults: Config,
): Persona | undefined {
  const configRecord = readRecord(manifestConfig)
  const meta = readRecord(configRecord?.['meta'])
  const extensions = readRecord(configRecord?.['extensions'])
  const personaExt = readRecord(extensions?.['persona'])

  if (!personaExt && !defaults.registerDefaultPersona) return undefined

  const metaName = meta?.['name']
  const name = typeof personaExt?.['name'] === 'string'
    ? personaExt['name']
    : typeof metaName === 'string'
      ? metaName
      : defaults.defaultName

  const systemPrompt = typeof personaExt?.['systemPrompt'] === 'string'
    ? personaExt['systemPrompt']
    : defaults.defaultSystemPrompt

  const traits = isStringArray(personaExt?.['traits'])
    ? personaExt?.['traits']
    : undefined

  const tone = typeof personaExt?.['tone'] === 'string'
    ? personaExt['tone']
    : defaults.defaultTone

  return {
    lifeId,
    name,
    systemPrompt,
    traits,
    tone,
    metadata: {
      source: personaExt ? 'manifest.extensions.persona' : 'plugin.default',
    },
  }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Plugin apply
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type PersonaLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface PersonaPluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap> }
    personaRegistry: PersonaRegistry
  }
  config: Config
  logger: PersonaLoggerLike
}

export interface PersonaPluginRuntime {
  service: PersonaService
  dispose(): void
}

export function createPersonaPluginRuntime(options: PersonaPluginRuntimeOptions): PersonaPluginRuntime {
  const { runtime, config, logger } = options

  logger.info('persona plugin apply started', {
    plugin: 'elysia-ai-persona',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const registry = runtime.personaRegistry
  const service: PersonaService = {
    register(persona) { registry.register(persona) },
    getByLifeId(lifeId) { return registry.getByLifeId(lifeId) },
    getAll() { return registry.getAll() },
    getRegistry() { return registry },
    getDiagnostics() {
      return {
        plugin: 'elysia-ai-persona',
        enabled: true,
        ready: true,
        serviceName: 'elysia.persona',
        metadata: { personaCount: registry.getAll().length },
      }
    },
  }
  const dispose = eventBus.on('life.loaded', ({ lifeId, config: lifeConfig }) => {
    const persona = resolvePersonaFromLifeConfig(lifeId, lifeConfig, config)
    if (!persona) {
      logger.debug('persona skipped because life has no persona extension', {
        plugin: 'elysia-ai-persona',
        phase: 'life.loaded',
        lifeId,
      })
      return
    }

    service.register(persona)

    logger.info('persona registered', {
      plugin: 'elysia-ai-persona',
      phase: 'life.loaded',
      lifeId,
      personaName: persona.name,
      hasTraits: Boolean(persona.traits?.length),
      tone: persona.tone,
      source: persona.metadata?.['source'],
    })
  })

  return {
    service,
    dispose() {
      dispose()
      logger.info('persona plugin disposed', {
        plugin: 'elysia-ai-persona',
        phase: 'dispose',
      })
    },
  }
}
