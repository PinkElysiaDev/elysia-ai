import type {
  Stimulus,
  ProjectionResolver,
  ProjectionRule,
  ProjectionRuleRepository,
  ScheduledTaskRepository,
  PersonaRegistry,
  ConversationStore,
  LifeStateRepository,
  HomeostasisState,
  BehaviorExecutionService,
  MemoryContextProvider,
  MemoryRepository,
  MemoryService,
  BondContextProvider,
  BondRepository,
  BondService,
  HomeostasisService,
} from '@elysia-ai/core'
import { MemoryEventBus } from '@elysia-ai/core'
import type { CoreEventMap } from '@elysia-ai/core'
import type { RuntimeContext, RuntimeLogger } from './context/index.js'
import type { LifeRegistry } from './registry/life-registry.js'
import type { HabitatRegistry } from './registry/habitat-registry.js'
import { MemoryLifeRegistry } from './registry/memory-life-registry.js'
import { MemoryHabitatRegistry } from './registry/memory-habitat-registry.js'
import { MemoryPersonaRegistry } from './registry/memory-persona-registry.js'
import { MemoryConversationStore } from './store/memory-conversation-store.js'
import { MemoryStateRepository } from './store/memory-state-repository.js'
import type { Lifecycle, LifecycleState } from './lifecycle/index.js'
import { MinimalLifecycle } from './lifecycle/minimal-lifecycle.js'
import type { ManifestConfig, LifeInstanceConfig } from './manifest/types.js'
import { DefaultProjectionResolver } from './projection/default-resolver.js'
import { MemoryProjectionRuleRepository } from './projection/memory-projection-rule-repository.js'
import { DefaultProjectionRuleService } from './projection/projection-rule-service.js'
import type { ProjectionRuleService } from './projection/projection-rule-service.js'
import { MemoryProjectionRegistry } from './projection/registry.js'
import type { ProjectionRegistry } from './projection/registry.js'
import { DefaultSchedulerService, MemoryScheduledTaskRepository } from './scheduler/index.js'
import type { SchedulerService } from './scheduler/index.js'
import { DefaultBehaviorExecutionService } from './behavior-execution/index.js'
import { DefaultHomeostasisService } from './homeostasis/index.js'

/**
 * 从生命体实例配置中解析显示名称
 *
 * 优先级：meta.name > id
 * 使用独立函数是为了让逻辑明确可测，避免内联 `as string` 转换隐藏类型问题
 *
 * @param instance 生命体实例配置
 * @returns 解析后的显示名称
 */
function resolveLifeName(instance: LifeInstanceConfig): string {
  const metaName = instance.meta?.['name']
  if (typeof metaName === 'string' && metaName.length > 0) {
    return metaName
  }
  return instance.id
}

function normalizeProjectionRule(
  lifeId: string,
  rule: Record<string, unknown>,
  index: number,
): ProjectionRule {
  const id = typeof rule.id === 'string' && rule.id.length > 0
    ? rule.id
    : `projection-${lifeId}-${index}`

  return {
    id,
    lifeId,
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    priority: typeof rule.priority === 'number' ? rule.priority : 0,
    habitatId: typeof rule.habitatId === 'string' ? rule.habitatId : undefined,
    channelId: typeof rule.channelId === 'string' ? rule.channelId : undefined,
    threadId: typeof rule.threadId === 'string' ? rule.threadId : undefined,
    actorId: typeof rule.actorId === 'string' ? rule.actorId : undefined,
    platform: typeof rule.platform === 'string' ? rule.platform : undefined,
    botId: typeof rule.botId === 'string' ? rule.botId : undefined,
    metadata: typeof rule.metadata === 'object' && rule.metadata !== null && !Array.isArray(rule.metadata)
      ? rule.metadata as Record<string, unknown>
      : undefined,
  }
}

function resolveProjectionRules(instance: LifeInstanceConfig): ProjectionRule[] {
  const projectionExt = instance.extensions?.['projection'] as
    | { rules?: unknown }
    | undefined
  const rules = Array.isArray(projectionExt?.rules) ? projectionExt.rules : []

  return rules.flatMap((rule, index) => {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return []
    return [normalizeProjectionRule(instance.id, rule as Record<string, unknown>, index)]
  })
}

export interface Runtime {
  context: RuntimeContext
  lifeRegistry: LifeRegistry
  habitatRegistry: HabitatRegistry
  personaRegistry: PersonaRegistry
  conversationStore: ConversationStore
  stateRepository: LifeStateRepository<HomeostasisState>
  lifecycle: Lifecycle
  projectionResolver: ProjectionResolver
  projectionRegistry: ProjectionRegistry
  projectionRuleRepository: ProjectionRuleRepository
  projectionRuleService: ProjectionRuleService
  scheduledTaskRepository: ScheduledTaskRepository
  scheduler: SchedulerService
  behaviorExecution: BehaviorExecutionService
  /** @deprecated provided by @elysia-ai/memory when installed */
  memoryRepository?: MemoryRepository
  /** @deprecated provided by @elysia-ai/memory when installed */
  memoryService?: MemoryService
  /** @deprecated provided by @elysia-ai/memory when installed */
  memoryContextProvider?: MemoryContextProvider
  /** @deprecated provided by @elysia-ai/bond when installed */
  bondRepository?: BondRepository
  /** @deprecated provided by @elysia-ai/bond when installed */
  bondService?: BondService
  /** @deprecated provided by @elysia-ai/bond when installed */
  bondContextProvider?: BondContextProvider
  homeostasisService: HomeostasisService

  start(): Promise<void>
  stop(): Promise<void>
  getState(): LifecycleState
  
  receiveStimulus(stimulus: Stimulus): Promise<void>
  
  /**
   * 从 ManifestConfig 加载生命体实例
   * 将所有 enabled 的 lifeInstance 注册到 lifeRegistry
   * 并对每个实例发出 life.loaded 事件
   */
  loadManifest(config: ManifestConfig): Promise<void>
}

const defaultRuntimeLogger: RuntimeLogger = {
  info(message, meta) {
    if (meta) {
      console.info(`[elysia-ai-runtime] ${message}`, meta)
      return
    }
    console.info(`[elysia-ai-runtime] ${message}`)
  },
  debug(message, meta) {
    if (meta) {
      console.debug(`[elysia-ai-runtime] ${message}`, meta)
      return
    }
    console.debug(`[elysia-ai-runtime] ${message}`)
  },
  error(message, error, meta) {
    if (meta && error) {
      console.error(`[elysia-ai-runtime] ${message}`, meta, error)
      return
    }
    if (error) {
      console.error(`[elysia-ai-runtime] ${message}`, error)
      return
    }
    if (meta) {
      console.error(`[elysia-ai-runtime] ${message}`, meta)
      return
    }
    console.error(`[elysia-ai-runtime] ${message}`)
  },
}

export class DefaultRuntime implements Runtime {
  public projectionResolver: ProjectionResolver
  public projectionRegistry: ProjectionRegistry
  public projectionRuleService: ProjectionRuleService
  public scheduler: SchedulerService
  public behaviorExecution: BehaviorExecutionService
  public memoryRepository?: MemoryRepository
  public memoryService?: MemoryService
  public memoryContextProvider?: MemoryContextProvider
  public bondRepository?: BondRepository
  public bondService?: BondService
  public bondContextProvider?: BondContextProvider
  public homeostasisService: HomeostasisService
  public personaRegistry: PersonaRegistry
  public conversationStore: ConversationStore

  constructor(
    public context: RuntimeContext,
    public lifeRegistry: LifeRegistry,
    public habitatRegistry: HabitatRegistry,
    public lifecycle: Lifecycle,
    projectionResolver?: ProjectionResolver,
    personaRegistry?: PersonaRegistry,
    conversationStore?: ConversationStore,
    public stateRepository: LifeStateRepository<HomeostasisState> = new MemoryStateRepository<HomeostasisState>(),
    projectionRegistry?: ProjectionRegistry,
    public projectionRuleRepository: ProjectionRuleRepository = new MemoryProjectionRuleRepository(),
    projectionRuleService?: ProjectionRuleService,
    public scheduledTaskRepository: ScheduledTaskRepository = new MemoryScheduledTaskRepository(),
    scheduler?: SchedulerService,
    behaviorExecution?: BehaviorExecutionService,
    memoryRepository?: MemoryRepository,
    memoryService?: MemoryService,
    memoryContextProvider?: MemoryContextProvider,
    bondRepository?: BondRepository,
    bondService?: BondService,
    bondContextProvider?: BondContextProvider,
    homeostasisService?: HomeostasisService,
  ) {
    this.projectionRegistry = projectionRegistry ?? new MemoryProjectionRegistry()
    this.projectionResolver = projectionResolver ?? new DefaultProjectionResolver(lifeRegistry, this.projectionRegistry)
    this.projectionRuleService = projectionRuleService ?? new DefaultProjectionRuleService(
      this.projectionRuleRepository,
      this.projectionRegistry,
      context.eventBus,
      context.logger,
    )
    this.scheduler = scheduler ?? new DefaultSchedulerService(
      this.scheduledTaskRepository,
      context.eventBus,
      {},
      context.logger,
    )
    this.behaviorExecution = behaviorExecution ?? new DefaultBehaviorExecutionService(
      context.eventBus,
      this.scheduler,
      context.logger,
    )
    this.memoryRepository = memoryRepository
    this.memoryService = memoryService
    this.memoryContextProvider = memoryContextProvider
    this.bondRepository = bondRepository
    this.bondService = bondService
    this.bondContextProvider = bondContextProvider
    this.homeostasisService = homeostasisService ?? new DefaultHomeostasisService(
      this.stateRepository,
      context.eventBus,
      context.logger,
    )
    this.personaRegistry = personaRegistry ?? new MemoryPersonaRegistry()
    this.conversationStore = conversationStore ?? new MemoryConversationStore()
  }

  async start(): Promise<void> {
    this.context.logger.info('runtime start requested')
    await this.lifecycle.start()
    if ('start' in this.homeostasisService && typeof this.homeostasisService.start === 'function') {
      this.homeostasisService.start()
    }
    if (this.scheduler.startLoop) {
      this.scheduler.startLoop({
        enabled: true,
        tickIntervalMs: 1000,
        batchSize: 100,
      })
    }
    this.context.logger.info('runtime started', {
      state: this.lifecycle.getState(),
    })
  }

  async stop(): Promise<void> {
    // 幂等保护：已停止时静默返回，不抛出错误
    // 这允许外层代码（如 Koishi dispose 事件）安全地多次调用 stop()
    if (this.lifecycle.getState() === 'stopped' || this.lifecycle.getState() === 'idle') {
      this.context.logger.debug('runtime stop skipped because runtime is not running', {
        state: this.lifecycle.getState(),
      })
      return
    }
    this.context.logger.info('runtime stop requested', {
      state: this.lifecycle.getState(),
    })
    this.scheduler.stopLoop?.()
    if ('stop' in this.homeostasisService && typeof this.homeostasisService.stop === 'function') {
      this.homeostasisService.stop()
    }
    await this.lifecycle.stop()
    this.context.logger.info('runtime stopped', {
      state: this.lifecycle.getState(),
    })
  }

  getState(): LifecycleState {
    return this.lifecycle.getState()
  }

  async receiveStimulus(stimulus: Stimulus): Promise<void> {
    if (!this.lifecycle.isRunning()) {
      // Runtime 未启动时，忽略 stimulus
      // 这是正常行为，不需要报错，调用方无需判断 runtime 状态
      this.context.logger.debug('stimulus ignored because runtime is not running', {
        stimulusId: stimulus.id,
        state: this.lifecycle.getState(),
      })
      return
    }

    this.context.logger.info('runtime received stimulus', {
      stimulusId: stimulus.id,
      stimulusType: stimulus.type,
      habitatId: stimulus.habitatId,
    })

    this.context.logger.debug('emitting stimulus.received event', {
      event: 'stimulus.received',
      stimulusId: stimulus.id,
      stimulusType: stimulus.type,
      habitatId: stimulus.habitatId,
    })

    // 发出 stimulus.received 事件
    await this.context.eventBus.emit('stimulus.received', {
      stimulusId: stimulus.id,
      stimulus,
    })

    // Projection routing：解析哪些 life 应该感知此 stimulus
    const routing = this.projectionResolver.resolve(stimulus)

    this.context.logger.debug('projection routing resolved', {
      stimulusId: stimulus.id,
      lifeIds: routing.lifeIds,
      reason: routing.reason,
    })

    await this.context.eventBus.emit('projection.routed', {
      stimulusId: stimulus.id,
      routing,
    })
  }

  async loadManifest(config: ManifestConfig): Promise<void> {
    this.context.logger.info('loading manifest', {
      lifeInstanceCount: config.lifeInstances.length,
    })
    // 注意：当前实现允许在 runtime 未启动时调用 loadManifest()
    // 这是有意为之的设计选择：允许在 start() 之前预加载配置
    // 如果需要强制要求在 running 状态下才能加载，可以在此处添加检查：
    //   if (!this.lifecycle.isRunning()) throw new Error('...')
    // 目前保持宽松策略，方便初始化流程中先加载配置再启动

    const now = Date.now()
    for (const instance of config.lifeInstances) {
      // 跳过 disabled 的实例
      if (instance.enabled === false) continue

      // 按 LifeInstance 接口构造
      // 注意：LifeInstance.name 从 meta.name 获取，不存在时回退为 id
      // instance.type 和 extensions 保存到 metadata 中，供其他插件通过 life.loaded 事件读取
      const lifeName = resolveLifeName(instance)
      this.lifeRegistry.register({
        id: instance.id,
        name: lifeName,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        metadata: {
          type: instance.type,
          extensions: instance.extensions,
          ...instance.meta,
        },
      })

      // 发出 life.loaded 事件，供其他插件监听并处理 extensions 配置
      this.context.logger.debug('registered life instance from manifest', {
        lifeId: instance.id,
        lifeName,
        type: instance.type,
      })

      // 解析 persona 配置（如果 extensions 中包含 persona）
      const personaExt = instance.extensions?.['persona'] as
        | { name?: string; systemPrompt?: string; traits?: string[]; tone?: string }
        | undefined

      if (personaExt?.systemPrompt) {
        this.personaRegistry.register({
          lifeId: instance.id,
          name: personaExt.name ?? lifeName,
          systemPrompt: personaExt.systemPrompt,
          traits: personaExt.traits,
          tone: personaExt.tone,
        })

        this.context.logger.debug('registered persona from manifest', {
          lifeId: instance.id,
          personaName: personaExt.name ?? lifeName,
          hasTraits: Boolean(personaExt.traits?.length),
        })
      }

      const projectionRules = resolveProjectionRules(instance)
      for (const rule of projectionRules) {
        await this.projectionRuleService.upsertRule(rule)
      }

      if (projectionRules.length > 0) {
        this.context.logger.debug('registered projection rules from manifest', {
          lifeId: instance.id,
          ruleCount: projectionRules.length,
          ruleIds: projectionRules.map((rule) => rule.id),
        })
      }

      await this.context.eventBus.emit('life.loaded', {
        lifeId: instance.id,
        type: instance.type,
        config: instance,
      })
    }

    this.context.logger.info('manifest loaded', {
      lifeInstanceCount: config.lifeInstances.filter((instance) => instance.enabled !== false).length,
    })
  }
}

export interface DefaultRuntimeOptions {
  logger?: RuntimeLogger
  stateRepository?: LifeStateRepository<HomeostasisState>
  projectionRuleRepository?: ProjectionRuleRepository
  projectionRegistry?: ProjectionRegistry
  projectionRuleService?: ProjectionRuleService
  scheduledTaskRepository?: ScheduledTaskRepository
  scheduler?: SchedulerService
  behaviorExecution?: BehaviorExecutionService
  memoryRepository?: MemoryRepository
  memoryService?: MemoryService
  memoryContextProvider?: MemoryContextProvider
  bondRepository?: BondRepository
  bondService?: BondService
  bondContextProvider?: BondContextProvider
  homeostasisService?: HomeostasisService
}

type NormalizedDefaultRuntimeOptions = Required<Pick<DefaultRuntimeOptions, 'logger'>>
  & Pick<DefaultRuntimeOptions,
    | 'stateRepository'
    | 'projectionRuleRepository'
    | 'projectionRegistry'
    | 'projectionRuleService'
    | 'scheduledTaskRepository'
    | 'scheduler'
    | 'behaviorExecution'
    | 'memoryRepository'
    | 'memoryService'
    | 'memoryContextProvider'
    | 'bondRepository'
    | 'bondService'
    | 'bondContextProvider'
    | 'homeostasisService'
  >

function normalizeDefaultRuntimeOptions(
  optionsOrLogger: RuntimeLogger | DefaultRuntimeOptions = {},
): NormalizedDefaultRuntimeOptions {
  if ('info' in optionsOrLogger && 'debug' in optionsOrLogger && 'error' in optionsOrLogger) {
    return {
      logger: optionsOrLogger,
    }
  }

  return {
    logger: optionsOrLogger.logger ?? defaultRuntimeLogger,
    stateRepository: optionsOrLogger.stateRepository,
    projectionRuleRepository: optionsOrLogger.projectionRuleRepository,
    projectionRegistry: optionsOrLogger.projectionRegistry,
    projectionRuleService: optionsOrLogger.projectionRuleService,
    scheduledTaskRepository: optionsOrLogger.scheduledTaskRepository,
    scheduler: optionsOrLogger.scheduler,
    behaviorExecution: optionsOrLogger.behaviorExecution,
    memoryRepository: optionsOrLogger.memoryRepository,
    memoryService: optionsOrLogger.memoryService,
    memoryContextProvider: optionsOrLogger.memoryContextProvider,
    bondRepository: optionsOrLogger.bondRepository,
    bondService: optionsOrLogger.bondService,
    bondContextProvider: optionsOrLogger.bondContextProvider,
    homeostasisService: optionsOrLogger.homeostasisService,
  }
}

export function createDefaultRuntime(optionsOrLogger: RuntimeLogger | DefaultRuntimeOptions = {}): Runtime {
  const options = normalizeDefaultRuntimeOptions(optionsOrLogger)
  const eventBus = new MemoryEventBus<CoreEventMap>()
  const context: RuntimeContext = {
    eventBus,
    logger: options.logger,
  }

  const lifeRegistry = new MemoryLifeRegistry()
  const habitatRegistry = new MemoryHabitatRegistry()
  const lifecycle = new MinimalLifecycle(eventBus)

  return new DefaultRuntime(
    context,
    lifeRegistry,
    habitatRegistry,
    lifecycle,
    undefined,
    undefined,
    undefined,
    options.stateRepository,
    options.projectionRegistry,
    options.projectionRuleRepository,
    options.projectionRuleService,
    options.scheduledTaskRepository,
    options.scheduler,
    options.behaviorExecution,
    options.memoryRepository,
    options.memoryService,
    options.memoryContextProvider,
    options.bondRepository,
    options.bondService,
    options.bondContextProvider,
    options.homeostasisService,
  )
}

