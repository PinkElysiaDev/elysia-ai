import type {
  Stimulus,
  ProjectionResolver,
  ProjectionRule,
  ProjectionRuleRepository,
  PersonaRegistry,
  ConversationStore,
  LifeStateRepository,
  HomeostasisState,
  BehaviorExecutionService,
  HomeostasisService,
} from '@elysia-ai/core'
import { MemoryEventBus } from '@elysia-ai/core'
import {
  ELYSIA_PIPELINE_STAGES,
  KNOWN_ELYSIA_SERVICE_IDS,
  PipelineRunner,
  PluginManifestRegistry,
  RequestContextStore,
  TraceRecorder,
  splitStageOrder,
} from '@elysia-ai/core'

// 类型化扩展事件（声明合并示范）：每次管线 trace 完成时发出事实通知，
// observatory 经 onAny 自动捕获，无需手工登记事件名。
declare module '@elysia-ai/core' {
  interface CoreEventMap {
    'runtime.trace.completed': {
      stimulusId: string
      kind: 'stimulus' | 'life'
      lifeId?: string
      root: import('@elysia-ai/kernel').TraceSpan
      events: import('@elysia-ai/kernel').TraceEventRecord[]
    }
  }
}
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

/** 同 habitat 优先级串行队列条目（数值小者先；同级 FIFO）。 */
interface PriorityQueueEntry {
  stimulus: Stimulus
  priority: number
  resolve: () => void
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
  behaviorExecution: BehaviorExecutionService
  homeostasisService: HomeostasisService

  start(): Promise<void>
  stop(): Promise<void>
  getState(): LifecycleState

  receiveStimulus(stimulus: Stimulus, options?: { priority?: number }): Promise<void>
  
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
  public behaviorExecution: BehaviorExecutionService
  public homeostasisService: HomeostasisService
  public personaRegistry: PersonaRegistry
  public conversationStore: ConversationStore
  /**
   * 同 habitat 刺激优先级串行队列（P1-9 串行语义 + vtuber 插队语义）。
   * 数值小者先执行；稳定插入保持同级 FIFO；正在执行的任务不可抢占，
   * 只对未开始的条目插队。跨 habitat 并行不变。
   */
  private readonly stimulusQueues = new Map<string, { entries: PriorityQueueEntry[], draining: boolean }>()
  /** loadManifest 收集的 extensions 命名空间键（start 时对齐校验用）。 */
  private readonly manifestExtensionNamespaces = new Set<string>()
  /** 延迟兼容审计定时器（stop 时清除）。 */
  private auditTimer?: ReturnType<typeof setTimeout>

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
    behaviorExecution?: BehaviorExecutionService,
    homeostasisService?: HomeostasisService,
  ) {
    // kernel 管线原语补齐：即使宿主传入裸上下文（单包测试场景），
    // DefaultRuntime 也保证 pipeline/contexts/manifests 可用，
    // 能力包据此选择钩子装配而无需判空两条路径。
    context.pipeline ??= new PipelineRunner<unknown>({
      onError: (error, meta) => {
        context.logger.error('pipeline hook failed', error, {
          phase: 'pipeline',
          ...meta,
        })
      },
    })
    context.contexts ??= new RequestContextStore()
    context.manifests ??= new PluginManifestRegistry()
    for (const stage of ELYSIA_PIPELINE_STAGES) {
      context.pipeline.registerStage(stage)
    }
    this.projectionRegistry = projectionRegistry ?? new MemoryProjectionRegistry()
    this.projectionResolver = projectionResolver ?? new DefaultProjectionResolver(lifeRegistry, this.projectionRegistry)
    this.projectionRuleService = projectionRuleService ?? new DefaultProjectionRuleService(
      this.projectionRuleRepository,
      this.projectionRegistry,
      context.eventBus,
      context.logger,
    )
    this.behaviorExecution = behaviorExecution ?? new DefaultBehaviorExecutionService(
      context.eventBus,
      context.logger,
    )
    this.homeostasisService = homeostasisService ?? new DefaultHomeostasisService(
      this.stateRepository,
      context.eventBus,
      context.logger,
    )
    this.personaRegistry = personaRegistry ?? new MemoryPersonaRegistry()
    this.conversationStore = conversationStore ?? new MemoryConversationStore()
  }

  /**
   * 兼容性审计（公开）：manifest 依赖/版本/命名空间 + extensions 键对齐。
   * 逐条 warn 日志并返回全部问题（供调试命令复用）。
   * options.skipNamespaceCheck：start() 即时审计时置 true——此刻插件
   * 尚未注册，命名空间检查必然假阳性（Review BUG-2）。
   */
  auditCompatibility(options: { skipNamespaceCheck?: boolean } = {}): Array<{ plugin: string, severity: string, code: string, message: string, namespace?: string }> {
    const findings: Array<{ plugin: string, severity: string, code: string, message: string, namespace?: string }> = []
    // manifest 兼容治理（告警式）：依赖存在性 / 框架版本 / 命名空间冲突。
    const issues = this.context.manifests?.validate({
      knownServices: [...KNOWN_ELYSIA_SERVICE_IDS],
      knownStages: ELYSIA_PIPELINE_STAGES.map((stage) => stage.name),
    }) ?? []
    for (const issue of issues) {
      this.context.logger.warn?.(`plugin manifest issue: [${issue.severity}/${issue.code}] ${issue.message}`, {
        plugin: issue.plugin,
        phase: 'manifest-validate',
        code: issue.code,
        severity: issue.severity,
      })
      findings.push({ plugin: issue.plugin, severity: issue.severity, code: issue.code, message: issue.message })
    }
    if (options.skipNamespaceCheck) return findings
    // manifest.json extensions 命名空间对齐：键必须是已注册插件的
    // configNamespace，或 runtime 自身消费的内置命名空间（projection/persona）。
    const knownNamespaces = new Set<string>(['projection', 'persona'])
    for (const manifest of this.context.manifests?.getAll() ?? []) {
      if (manifest.configNamespace) knownNamespaces.add(manifest.configNamespace)
    }
    for (const namespace of this.manifestExtensionNamespaces) {
      if (!knownNamespaces.has(namespace)) {
        const message = `manifest extensions namespace "${namespace}" has no providing plugin (typo or plugin not installed?)`
        this.context.logger.warn?.(message, {
          plugin: 'elysia-ai-runtime',
          phase: 'manifest-validate',
          code: 'unknown-config-namespace',
          severity: 'warn',
          namespace,
        })
        findings.push({ plugin: 'elysia-ai-runtime', severity: 'warn', code: 'unknown-config-namespace', message, namespace })
      }
    }
    return findings
  }

  async start(): Promise<void> {
    this.context.logger.info('runtime start requested')
    await this.lifecycle.start()
    // 审计时机（Review BUG-2 修复）：start() 时其余插件（inject 等待者）
    // 尚未 apply、manifest 未注册——立即全量审计会漏检并假阳性。
    // 即时审计只查已注册 manifest（跳过 extensions 命名空间检查），
    // 延迟到下一宏任务再补一轮全量审计（覆盖同 tick 加载完成的插件）。
    this.auditCompatibility({ skipNamespaceCheck: true })
    if (this.auditTimer) clearTimeout(this.auditTimer)
    this.auditTimer = setTimeout(() => {
      this.auditTimer = undefined
      this.auditCompatibility()
    }, 0)
    this.auditTimer.unref?.()
    if ('start' in this.homeostasisService && typeof this.homeostasisService.start === 'function') {
      this.homeostasisService.start()
    }
    this.context.logger.info('runtime started', {
      state: this.lifecycle.getState(),
    })
  }

  async stop(): Promise<void> {
    // 取消未触发的延迟兼容审计。
    if (this.auditTimer) {
      clearTimeout(this.auditTimer)
      this.auditTimer = undefined
    }
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

  async receiveStimulus(stimulus: Stimulus, options?: { priority?: number }): Promise<void> {
    if (!this.lifecycle.isRunning()) {
      // Runtime 未启动时，忽略 stimulus
      // 这是正常行为，不需要报错，调用方无需判断 runtime 状态
      this.context.logger.debug('stimulus ignored because runtime is not running', {
        stimulusId: stimulus.id,
        state: this.lifecycle.getState(),
      })
      return
    }

    // 同一 habitat 的刺激串行处理（P1-9）：Koishi 消息天然并发，而
    // homeostasis / bond / memory 的更新是"读-改-写"，两个 projection.routed
    // 处理流交错会互相覆盖状态。不同 habitat 之间仍并行。
    // 优先级（vtuber 插队语义）：即时唤醒（被@/私聊，priority 0）可插到
    // 等待中的批量唤醒前，正在执行的不可抢占。
    const queueKey = stimulus.habitatId || '_global'
    const priority = options?.priority ?? 1
    const queue = this.stimulusQueues.get(queueKey) ?? { entries: [], draining: false }
    this.stimulusQueues.set(queueKey, queue)

    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => { resolveDone = resolve })
    // 稳定插入：插到第一个"优先级数值更大"（更低优先级）的条目前；同级 FIFO
    const entry: PriorityQueueEntry = { stimulus, priority, resolve: resolveDone }
    const insertBefore = queue.entries.findIndex((item) => item.priority > priority)
    if (insertBefore === -1) queue.entries.push(entry)
    else queue.entries.splice(insertBefore, 0, entry)

    void this.drainStimulusQueue(queueKey, queue)
    await done
  }

  private async drainStimulusQueue(queueKey: string, queue: { entries: PriorityQueueEntry[], draining: boolean }): Promise<void> {
    if (queue.draining) return
    queue.draining = true
    try {
      while (queue.entries.length > 0) {
        const entry = queue.entries.shift()!
        try {
          await this.processStimulus(entry.stimulus)
        } catch (error) {
          // processStimulus 内部 emit 已隔离监听器错误；此处兜底队列条目异常，
          // 避免单条失败毒化同 habitat 后续消息的处理链。
          this.context.logger.error('stimulus processing failed in habitat queue', error, {
            stimulusId: entry.stimulus.id,
            habitatId: entry.stimulus.habitatId,
          })
        } finally {
          entry.resolve()
        }
      }
    } finally {
      queue.draining = false
      if (queue.entries.length === 0) {
        this.stimulusQueues.delete(queueKey)
      }
    }
  }

  private async processStimulus(stimulus: Stimulus): Promise<void> {
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

    // 发出 stimulus.received 事件（事实通知；观测者与迁移期事件装配消费）
    await this.context.eventBus.emit('stimulus.received', {
      stimulusId: stimulus.id,
      stimulus,
    })

    // ── 刺激段管线（每 stimulus 一次）：stimulus.received → perception ──
    // 阶段是命令侧编排；事件照发，观测/旁路消费者不受影响。
    // trace 完成回调 → runtime.trace.completed 事实事件（observatory 消费）。
    const pipeline = this.context.pipeline
    const contexts = this.context.contexts
    const emitTrace = (kind: 'stimulus' | 'life', lifeId: string | undefined) =>
      new TraceRecorder((root, traceEvents) => {
        void this.context.eventBus.emit('runtime.trace.completed', {
          stimulusId: stimulus.id,
          kind,
          lifeId,
          root,
          events: traceEvents,
        })
      })
    const stimulusContext = pipeline && contexts
      ? contexts.create({ id: stimulus.id, core: { stimulus }, trace: emitTrace('stimulus', undefined) })
      : undefined
    try {
      if (pipeline && stimulusContext) {
        // 动态切分（Review BUG-1 修复）：基于 runner 实际注册阶段（含第三方）
        // 按 cognition 锚点切分，固定清单会漏掉 perception/cognition 之间的阶段。
        await pipeline.run(stimulusContext, { stages: splitStageOrder(pipeline.getStageOrder()).stimulusPhase })
      }

      // Projection routing：解析哪些 life 应该感知此 stimulus
      const routing = this.projectionResolver.resolve(stimulus)

      this.context.logger.debug('projection routing resolved', {
        stimulusId: stimulus.id,
        lifeIds: routing.lifeIds,
        reason: routing.reason,
      })

      await this.context.eventBus.emit('projection.routed', {
        stimulusId: stimulus.id,
        triggerSource: stimulus.metadata?.triggerSource as string | undefined,
        stimulusType: stimulus.type,
        routing,
      })

      // ── 生命段管线（每个路由命中的 lifeId 一次）：
      //    cognition → behavior.decide → behavior.execute → dialogue → sender ──
      // 生命段上下文以刺激段为父链：perception 结果经 NS_PERCEPTION 可见。
      if (pipeline && contexts && stimulusContext) {
        for (const lifeId of routing.lifeIds) {
          const lifeContext = contexts.create({
            id: `${stimulus.id}:${lifeId}`,
            core: { stimulus, lifeId, routing },
            parent: stimulusContext,
            trace: emitTrace('life', lifeId),
          })
          try {
            await pipeline.run(lifeContext, { stages: splitStageOrder(pipeline.getStageOrder()).lifePhase })
          } finally {
            lifeContext.trace.finish()
            contexts.delete(lifeContext.id)
          }
        }
      }
    } finally {
      if (stimulusContext) {
        stimulusContext.trace.finish()
        contexts?.delete(stimulus.id)
      }
      // 低频兜底清扫超龄上下文（正常路径已即时 delete）。
      if (contexts && contexts.size > 64) {
        contexts.sweep()
      }
    }
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

      // 收集 extensions 命名空间键，start() 时对齐 manifest 注册表校验。
      for (const namespace of Object.keys(instance.extensions ?? {})) {
        this.manifestExtensionNamespaces.add(namespace)
      }

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
  behaviorExecution?: BehaviorExecutionService
  homeostasisService?: HomeostasisService
}

type NormalizedDefaultRuntimeOptions = Required<Pick<DefaultRuntimeOptions, 'logger'>>
  & Pick<DefaultRuntimeOptions,
    | 'stateRepository'
    | 'projectionRuleRepository'
    | 'projectionRegistry'
    | 'projectionRuleService'
    | 'behaviorExecution'
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
    behaviorExecution: optionsOrLogger.behaviorExecution,
    homeostasisService: optionsOrLogger.homeostasisService,
  }
}

export function createDefaultRuntime(optionsOrLogger: RuntimeLogger | DefaultRuntimeOptions = {}): Runtime {
  const options = normalizeDefaultRuntimeOptions(optionsOrLogger)
  const eventBus = new MemoryEventBus<CoreEventMap>()
  const context: RuntimeContext = {
    eventBus,
    logger: options.logger,
    // 构造函数内会注册 ELYSIA_PIPELINE_STAGES（pipeline ??= 分支保留防御语义）
    pipeline: new PipelineRunner<unknown>({
      onError: (error, meta) => {
        options.logger.error('pipeline hook failed', error, { phase: 'pipeline', ...meta })
      },
    }),
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
    options.behaviorExecution,
    options.homeostasisService,
  )
}

