import type {
  BehaviorExecutionInstruction,
  TriggerTaskRepository,
  BehaviorExecutionService,
  BehaviorService,
  BehaviorTriggerRequest,
  CapabilityDiagnostics,
  CognitionService,
  CoreEventMap,
  EventBus,
  PipelineRunner,
  Stimulus,
  TriggerEvent,
} from '@elysia-ai/core'
import { NS_BEHAVIOR, STAGE_BEHAVIOR_DECIDE, STAGE_BEHAVIOR_EXECUTE } from '@elysia-ai/core'
import { BoundedCache } from '@elysia-ai/shared'
import {
  AdaptiveBatcher,
  CommandSystem,
  DEFAULT_INSTANT_RULES,
  EventsPackMemory,
  InstantEngine,
  isBatchableEventKey,
} from '@elysia-ai/trigger'
import type {
  BatcherConfig,
  CommandExecResult,
  CommandItem,
  EventsPackEntry,
  InstantItem,
} from '@elysia-ai/trigger'
import { createBehaviorExecutionPlan } from './execution-plan.js'
import { MemoryTriggerTaskRepository, TriggerManager } from './trigger-manager.js'
import type { TriggerAdminActor } from './trigger-manager.js'
import { createTriggerToolEntry } from './trigger-tool.js'
import { createWakeToolState, createWakeTools, resolveWakeOutput, WAKE_TOOLS_SYSTEM_HINT } from './tools.js'
import type { Config, HabitatRouting, WakeArtifact } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

export const internalName = 'elysia-ai-behavior'

/** 合成刺激 id 防碰撞序列：同 habitat 多任务同毫秒到期时 id 仍唯一。 */
let wakeSequence = 0
/** W3：系统公告刺激 id 防碰撞序列（原 `${kind}:${habitat}:${now}` 同毫秒同目录会撞 id）。 */
let announceSequence = 0

export * from './types.js'
export { createWakeTools, createWakeToolState, resolveWakeOutput, WAKE_TOOLS_SYSTEM_HINT } from './tools.js'
export { MongoTriggerTaskRepository, MONGO_TRIGGER_TASKS_COLLECTION, resolveTriggerTaskRepository } from './mongo-trigger-task-repository.js'
export type { MongoTriggerTaskDocument, MongoTriggerTaskRepositoryOptions } from './mongo-trigger-task-repository.js'

/** 合并器轮询间隔（vtuber 同款 200ms：参数热更新即时生效，无悬挂定时器）。 */
const TICK_MS = 200

type BehaviorLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface BehaviorPluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap>, pipeline?: PipelineRunner<unknown> }
    /** 合成触发刺激经此走完整主链（含投影路由与同 habitat 优先级串行）。 */
    receiveStimulus: (stimulus: Stimulus, options?: { priority?: number }) => void
    behaviorExecution?: BehaviorExecutionService
  }
  /** cognition（事件注入层）服务：feed 与事件历史的来源。 */
  cognition?: CognitionService
  /** 指令回执/即时模板的发送通道（wrapper 从 body sender 接线；缺省时仅入事件清单） */
  sendToHabitat?: (target: { platform?: string, channelId?: string }, content: string) => Promise<boolean>
  /** 触发器管理员判定（宿主回调：koishi authority 等；白名单在 config.triggers） */
  checkTriggerAdmin?: (actor: TriggerAdminActor) => Promise<boolean>
  /** 贴表情回调（wrapper 从 koishi bot.internal.setMsgEmojiLike 接线）；提供时注册 add_reaction 工具 */
  addReaction?: (target: { platform?: string, botId?: string }, messageId: string, emojiId: string) => Promise<boolean>
  /** 定时触发器任务仓储注入口（缺省内存版；wrapper 按配置/持久化服务选择） */
  triggerTaskRepository?: TriggerTaskRepository
  /**
   * 稳态状态读取（P2-19 读路径）：唤醒时把四值状态注入提示交 LLM 自主调节。
   * 返回 undefined（服务缺失/无状态）时跳过状态段，不阻断唤醒。
   */
  getHomeostasis?: (lifeId: string) => {
    energy: number
    mood: number
    sociability: number
    curiosity: number
  } | undefined
  config: Config
  logger: BehaviorLoggerLike
}

export interface BehaviorPluginRuntime {
  service: BehaviorService
  dispose(): void
}

/** per (lifeId × habitatId) 的触发器状态。 */
interface ScopeState {
  batcher: AdaptiveBatcher
  packs: EventsPackMemory
  isDirect: boolean
}

export function createBehaviorPluginRuntime(options: BehaviorPluginRuntimeOptions): BehaviorPluginRuntime {
  const { runtime, cognition, logger } = options
  // 防御性合并默认值：测试/旧调用方可能传部分形状的 config
  const config = {
    ...DEFAULT_CONFIG,
    ...options.config,
    batcher: { ...DEFAULT_CONFIG.batcher, ...options.config.batcher },
    packMemory: { ...DEFAULT_CONFIG.packMemory, ...options.config.packMemory },
    triggers: { ...DEFAULT_CONFIG.triggers, ...options.config.triggers },
    commands: options.config.commands ?? DEFAULT_CONFIG.commands,
    instantRules: options.config.instantRules ?? DEFAULT_CONFIG.instantRules,
  }

  logger.info('behavior plugin apply started', {
    plugin: 'elysia-ai-behavior',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const habitatRouting = new BoundedCache<string, HabitatRouting>(500)
  const scopes = new BoundedCache<string, ScopeState>(300)

  const scopeKey = (lifeId: string, habitatId: string) => `${lifeId}:${habitatId}`

  const batcherConfigFor = (isDirect: boolean): BatcherConfig => ({
    enabled: true,
    quietWindowMs: isDirect ? config.batcher.dmQuietWindowMs : config.batcher.quietWindowMs,
    maxWaitMs: config.batcher.maxWaitMs,
    densityWindowMs: config.batcher.densityWindowMs,
    densityThreshold: config.batcher.densityThreshold,
    maxBatch: config.batcher.maxBatch,
  })

  /**
   * 取/建 per (lifeId × habitatId) 作用域状态。
   *
   * isDirect 更新语义：仅真实消息路径（ingestForLife）允许刷新已有作用域的
   * isDirect；fireTrigger 等合成刺激路径传 { updateDirect: false } 防止
   * 把既有作用域的私聊/群聊判定覆盖掉。
   */
  const getScope = (
    lifeId: string,
    habitatId: string,
    isDirect: boolean,
    options?: { updateDirect?: boolean },
  ): ScopeState => {
    const key = scopeKey(lifeId, habitatId)
    const existing = scopes.get(key)
    if (existing) {
      if (options?.updateDirect !== false) existing.isDirect = isDirect
      return existing
    }
    const state: ScopeState = {
      batcher: new AdaptiveBatcher({
        getConfig: () => batcherConfigFor(state.isDirect),
        shouldCollect: (event) => isBatchableEventKey(event.key),
        onFire: (fire) => {
          void fireTrigger({
            lifeId,
            habitatId,
            source: 'batcher',
            reason: fire.reason,
            events: fire.events,
          })
        },
      }),
      packs: new EventsPackMemory({ maxPacks: config.packMemory.maxPacks }),
      isDirect,
    }
    scopes.set(key, state)
    return state
  }

  /** 标记刺激的分发副作用已被某个 life 消费（多 life 去重）。 */
  const markDispatchConsumed = (stimulus: Stimulus): void => {
    stimulus.metadata = { ...stimulus.metadata, dispatchConsumed: true }
  }

  /** 从 scopes 推导某 habitat 的 life（唯一时取之；多 life 同 habitat 返回 undefined）。 */
  const resolveLifeIdForHabitat = (habitatId: string): string | undefined => {
    const lives = new Set<string>()
    for (const key of scopes.keys()) {
      const separator = key.indexOf(':')
      if (separator <= 0) continue
      if (key.slice(separator + 1) !== habitatId) continue
      lives.add(key.slice(0, separator))
    }
    return lives.size === 1 ? [...lives][0] : undefined
  }

  // ── 第一/二层：指令直达与即时应对 ──
  const commandSystem = new CommandSystem({
    getConfig: () => config.commands ?? [],
  })
  const instantEngine = new InstantEngine({
    getConfig: () => config.instantRules ?? DEFAULT_INSTANT_RULES,
  })

  /** 系统公告刺激：写入事件清单让模型知情（经完整主链，cognition 入账）。 */
  const announceSystemEvent = (
    lifeId: string,
    habitatId: string,
    eventKind: string,
    payload: Record<string, unknown>,
  ): void => {
    const now = Date.now()
    try {
      runtime.receiveStimulus({
        id: `${eventKind}:${habitatId}:${now}-${++announceSequence}`,
        type: 'system',
        timestamp: now,
        habitatId,
        lifeId,
        payload: { eventKind, ...payload },
        metadata: { eventKind },
      })
    } catch (error) {
      logger.error('announce system event failed', error, {
        plugin: 'elysia-ai-behavior',
        phase: 'dispatch',
        eventKind,
        habitatId,
      })
    }
  }

  /** 经 habitat 通道发送文本；返回是否实际发出（未发出不消耗冷却）。 */
  const sendTextToHabitat = async (habitatId: string, text: string): Promise<boolean> => {
    if (!options.sendToHabitat || text === '') return false
    const routing = habitatRouting.get(habitatId)
    try {
      return await options.sendToHabitat({ platform: routing?.platform, channelId: routing?.channelId }, text)
    } catch (error) {
      logger.error('sendTextToHabitat failed', error, {
        plugin: 'elysia-ai-behavior',
        phase: 'dispatch',
        habitatId,
      })
      return false
    }
  }

  const dispatchCommandExecuted = (result: CommandExecResult, event: import('@elysia-ai/core').TriggerEvent, lifeId: string): void => {
    void (async () => {
      let sent = false
      if (result.receipt !== undefined) {
        sent = await sendTextToHabitat(event.habitatId, result.receipt)
      }
      if (result.announce) {
        announceSystemEvent(lifeId, event.habitatId, 'system.command.executed', {
          command: result.commandId,
          keyword: result.keyword,
          ok: result.ok,
          message: sent ? result.message : `${result.message}（回执未发出）`,
          actorName: event.actorName,
          actorId: event.actorId,
        })
      }
    })()
  }

  // ── 触发唤醒：合成触发刺激走完整主链（followup 模式的推广）──
  const fireTrigger = (request: BehaviorTriggerRequest): void => {
    if (!config.enableReply) {
      logger.debug('trigger suppressed by enableReply=false', {
        plugin: 'elysia-ai-behavior',
        phase: 'trigger',
        lifeId: request.lifeId,
        habitatId: request.habitatId,
        source: request.source,
      })
      return
    }

    // 合成刺激路径不刷新 isDirect（见 getScope 注释）：fireTrigger 只借作用域记 pack，
    // 通道类型判定权归真实消息。
    const scope = getScope(request.lifeId, request.habitatId, false, { updateDirect: false })
    const habitatInfo = habitatRouting.get(request.habitatId)
    const routing = request.routing ?? habitatInfo ?? {}
    const now = Date.now()
    const lastEvent = request.events?.[request.events.length - 1]
      ?? [...(cognition?.getRecentEvents(request.lifeId, request.habitatId) ?? [])].pop()

    // pack 存档：本次唤醒时刻的世界快照（在提示组装后记录，见 decide 钩子）
    const packsSnapshot = cognition?.getRecentEvents(request.lifeId, request.habitatId) ?? []

    // W2-11：唤醒时刻的触发者归因快照——写入 metadata 供 trigger 工具权限判定锁定，
    // 避免组装时刻重新查 lastEvent（cognition 滚动窗口已推进，归因会漂移到
    // 唤醒后新说话的人）。platform/botId 取路由快照（TriggerEvent 本身不携带）。
    const wakeActor = lastEvent?.actorId
      ? { userId: lastEvent.actorId, platform: routing.platform, botId: routing.botId }
      : undefined

    const stimulus: Stimulus = {
      id: `${request.habitatId}:trigger:${request.source}:${now}-${++wakeSequence}`,
      type: 'addressing',
      timestamp: now,
      habitatId: request.habitatId,
      lifeId: request.lifeId,
      actorId: lastEvent?.actorId,
      platform: routing.platform,
      botId: routing.botId,
      guildId: routing.guildId,
      channelId: routing.channelId,
      isDirectMessage: habitatInfo?.isDirectMessage,
      isMentioned: true,
      payload: {
        content: request.directive ?? '',
        triggerSource: request.source,
        triggerReason: request.reason,
      },
      metadata: {
        triggerSource: request.source,
        triggerReason: request.reason,
        generatedBy: 'elysia-ai-behavior',
        directive: request.directive,
        packsSnapshotCount: packsSnapshot.length,
        ...(wakeActor ? { wakeActor } : {}),
      },
    }

    // pack 记忆入档（触发即存档；提示注入在 decide 钩子组装时取 recent）。
    // W3：空快照不入档——cognition 缺失/冷启动时记空 pack 只会稀释 pack 注入。
    if (packsSnapshot.length > 0) {
      scope.packs.record({
        firedAt: now,
        source: request.source,
        reason: request.reason,
        events: packsSnapshot,
      })
    }

    void eventBus.emit('behavior.trigger.fired', {
      lifeId: request.lifeId,
      habitatId: request.habitatId,
      source: request.source,
      reason: request.reason,
      stimulusId: stimulus.id,
    })

    logger.info('trigger fired; synthesizing stimulus into main chain', {
      plugin: 'elysia-ai-behavior',
      phase: 'trigger',
      lifeId: request.lifeId,
      habitatId: request.habitatId,
      source: request.source,
      reason: request.reason,
      stimulusId: stimulus.id,
      snapshotEvents: packsSnapshot.length,
    })

    try {
      // vtuber 插队语义：即时唤醒（被@/私聊/即时规则）优先级 0，
      // 插到同 habitat 等待中的批量/定时唤醒之前；正在执行的不可抢占。
      runtime.receiveStimulus(stimulus, {
        priority: request.source === 'instant' ? 0 : 1,
      })
    } catch (error) {
      logger.error('receiveStimulus rejected synthesized trigger stimulus', error, {
        plugin: 'elysia-ai-behavior',
        phase: 'trigger',
        stimulusId: stimulus.id,
      })
    }
  }

  // ── 第四层：定时触发器（与即时响应同等地位）──
  const triggerManager = new TriggerManager({
    store: options.triggerTaskRepository ?? new MemoryTriggerTaskRepository(),
    config: () => config.triggers,
    fire: ({ task, source, habitatId, lifeId, routing }) => {
      // 真实 lifeId 优先级：广播展开解析 > task.lifeId > 从 scopes 推导该 habitat 的 life。
      // W2-13：解析失败（'' 结果）不再点火——空串哨兵会绕过多 life 防放大守卫（falsy）
      // 且 pack 会记入无人读的作用域；warn 后直接跳过（广播路径不受影响，已带真实 lifeId）。
      const effectiveLifeId = lifeId ?? task.lifeId ?? resolveLifeIdForHabitat(habitatId ?? task.habitatId) ?? ''
      if (effectiveLifeId === '') {
        logger.warn?.('trigger fire skipped: no lifeId resolved for habitat', {
          plugin: 'elysia-ai-behavior',
          phase: 'trigger',
          taskId: task.id,
          habitatId: habitatId ?? task.habitatId,
          source,
        })
        return
      }
      fireTrigger({
        lifeId: effectiveLifeId,
        habitatId: habitatId ?? task.habitatId,
        source,
        reason: `定时任务:${task.name}`,
        directive: task.prompt,
        // 广播展开到其他 habitat 时不带创建会话路由（由 fireTrigger 实时解析）
        ...(routing ? { routing } : {}),
      })
    },
    // 广播任务展开：枚举该 life 的全部活跃窗口（scopes 缓存键 = lifeId:habitatId），
    // 返回 {lifeId, habitatId} 对——fire 时携带真实 lifeId 供守卫与 pack 归属。
    listHabitats: (lifeId) => {
      const targets = new Map<string, { lifeId: string, habitatId: string }>()
      for (const key of scopes.keys()) {
        const separator = key.indexOf(':')
        if (separator <= 0) continue
        const scopeLifeId = key.slice(0, separator)
        const habitatId = key.slice(separator + 1)
        if (lifeId && scopeLifeId !== lifeId) continue
        targets.set(`${scopeLifeId}:${habitatId}`, { lifeId: scopeLifeId, habitatId })
      }
      return [...targets.values()]
    },
    checkAdmin: options.checkTriggerAdmin,
    logger,
  })
  if (config.triggers.enabled) {
    void triggerManager.start()
  }

  const service: BehaviorService = {
    fireTrigger(request) {
      fireTrigger(request)
    },
    getTriggerManager() {
      return triggerManager
    },
    getDiagnostics(): CapabilityDiagnostics {
      return {
        plugin: 'elysia-ai-behavior',
        enabled: true,
        ready: true,
        serviceName: 'elysia.behavior',
        metadata: {
          enableReply: config.enableReply,
          trackedScopes: scopes.size,
          quietWindowMs: config.batcher.quietWindowMs,
          dmQuietWindowMs: config.batcher.dmQuietWindowMs,
        },
      }
    },
  }

  // ── 唤醒提示组装（decide 钩子内、触发刺激到达时）──
  const buildWakeUserMessage = (
    stimulus: Stimulus,
    lifeId: string,
    scope: ScopeState,
    lastEvent?: TriggerEvent,
  ): { userMessage: string; summary: string; lastEvent?: TriggerEvent } => {
    const parts: string[] = []
    const directive = typeof stimulus.metadata?.directive === 'string' && stimulus.metadata.directive !== ''
      ? stimulus.metadata.directive
      : undefined
    const source = typeof stimulus.metadata?.triggerSource === 'string' ? stimulus.metadata.triggerSource : 'unknown'
    const reason = typeof stimulus.metadata?.triggerReason === 'string' ? stimulus.metadata.triggerReason : 'unknown'
    const feedCount = cognition?.buildFeed(lifeId, stimulus.habitatId).length ?? 0
    if (directive) {
      parts.push(`【指令】${directive}`)
    } else {
      parts.push(`【指令】${WAKE_TOOLS_SYSTEM_HINT}`)
    }

    // 稳态状态段（P2-19 读路径）：有状态时注入四值让 LLM 自主把握回复分寸，
    // 不回门控；getHomeostasis 缺失或无状态时静默跳过。
    const homeostasis = options.getHomeostasis?.(lifeId)
    if (homeostasis) {
      parts.push(
        `你当前的状态：精力 ${homeostasis.energy.toFixed(2)}、心情 ${homeostasis.mood.toFixed(2)}`
        + `、社交意愿 ${homeostasis.sociability.toFixed(2)}、好奇心 ${homeostasis.curiosity.toFixed(2)}`
        + '（0-1，低精力时回复可以简短些，心情好可以更活泼——由你自行把握分寸）',
      )
    }

    const feed = cognition?.buildFeed(lifeId, stimulus.habitatId) ?? []
    parts.push(`=== 聊天实时事件（最新在最下） ===\n${feed.length ? feed.join('\n') : '（暂无事件）'}`)

    if (config.packMemory.injectPacks > 0) {
      // 排除"本次"pack（fire 时刚记录的当前快照）：它与上方实时事件清单内容重复，
      // 注入的应是"此前几次"触发时的世界。多取一条再剔除最新。
      const taken = scope.packs.recent(config.packMemory.injectPacks + 1)
      const recentPacks = taken.length > 1 ? taken.slice(0, taken.length - 1) : []
      if (recentPacks.length) {
        const rendered = recentPacks.map((entry) => scope.packs.renderEntry(entry, {
          maxLines: 10,
        }))
        parts.push(`=== 最近几次触发时的情形 ===\n${rendered.join('\n---\n')}`)
      }
    }

    void lastEvent
    // 一行摘要：入 episodic 记忆与对话史的形态。唤醒全文（指令+稳态+30 行
    // 事件清单+pack 注入）只做本轮 LLM 输入——入库会随 memoryLimit 反复
    // 重放、稀释检索并放大上下文成本。
    const summary = `触发唤醒(${source}/${reason})，事件 ${feedCount} 条`
      + (directive ? `，指令: ${directive.slice(0, 80)}` : '')
    return { userMessage: parts.join('\n\n'), summary, lastEvent }
  }

  // ── 唤醒工件：触发刺激的 decide 分支 ──
  const buildWakeArtifact = (stimulus: Stimulus, lifeId: string): WakeArtifact => {
    const source = stimulus.metadata?.triggerSource as WakeArtifact['source']
    const reason = typeof stimulus.metadata?.triggerReason === 'string' ? stimulus.metadata.triggerReason : 'unknown'
    const scope = getScope(lifeId, stimulus.habitatId, stimulus.isDirectMessage === true)
    const recent = cognition?.getRecentEvents(lifeId, stimulus.habitatId) ?? []
    const lastEvent = [...recent].pop()

    const { userMessage, summary: wakeSummary } = buildWakeUserMessage(stimulus, lifeId, scope, lastEvent)
    const toolState = createWakeToolState()
    // add_reaction 缺省目标：最近一条 message 组事件的 stimulusId（平台真实消息 id）。
    // 不能用 lastEvent.stimulusId——reaction/member 等事件的合成 id 传给平台必失败。
    const recentMessageId = [...recent].reverse()
      .find((item) => item.key === 'message' || item.key === 'mention' || item.key === 'reply' || item.key === 'direct-message')
      ?.stimulusId
    const tools = createWakeTools({
      state: toolState,
      getRecentPacks: (limit) => scope.packs.recent(limit),
      renderPack: (entry) => scope.packs.renderEntry(entry, { maxLines: 15 }),
      lastEvent,
      recentMessageId,
      ...(options.addReaction
        ? {
            addReaction: (messageId: string, emojiId: string) =>
              options.addReaction!({ platform: stimulus.platform, botId: stimulus.botId }, messageId, emojiId),
          }
        : {}),
    })
    // 定时触发器自管理工具（管理员可写；目标锁定当前 habitat）。
    // 定时/批量唤醒（source 非 instant/manual）降为只读：actor 归因取的是
    // 点火前最后说话的人，写权限归因错配，只放行 list/get。
    // W2-11：actor 优先用点火时刻锁定的 wakeActor 快照（完整 {userId, platform, botId}），
    // 回退到组装时刻的 lastEvent/stimulus——cognition 滚动窗口推进后重新查 lastEvent
    // 会把权限归因漂移到唤醒后新说话的人。
    const wakeActor = stimulus.metadata?.wakeActor as { userId?: string, platform?: string, botId?: string } | undefined
    if (config.triggers.enabled) {
      tools.push(createTriggerToolEntry({
        manager: triggerManager,
        habitatId: stimulus.habitatId,
        lifeId,
        readOnly: source !== 'instant' && source !== 'manual',
        actor: {
          userId: wakeActor?.userId ?? lastEvent?.actorId ?? stimulus.actorId,
          platform: wakeActor?.platform ?? stimulus.platform,
          botId: wakeActor?.botId ?? stimulus.botId,
        },
        routing: {
          platform: stimulus.platform,
          botId: stimulus.botId,
          guildId: stimulus.guildId,
          channelId: stimulus.channelId,
        },
      }))
    }

    const habitatScope = { type: 'habitat' as const, key: stimulus.habitatId }
    const planShape = {
      scope: habitatScope,
      sourceStimulusIds: [stimulus.id],
      mode: 'send-to-ai' as const,
      plannerSource: 'program' as const,
      reason: `trigger:${source}:${reason}`,
    }

    // W2-12：非 instant 来源（scheduled/manual/batcher）的记忆/羁绊归因降级——
    // 唤醒时的 lastEvent.actorId 只是"点火前最后说话的人"，据此把定时唤醒的
    // 记忆写进某个人的 scope / 羁绊记到某人名下都是归因错配；用 actorId 置空的
    // stimulus 副本构造 statePlan，让 execution-plan 的 memory scope / bond
    // targetType 落 habitat 档。
    const attributedStimulus = source === 'instant' ? stimulus : { ...stimulus, actorId: undefined }
    const statePlan = createBehaviorExecutionPlan({
      stimulus: attributedStimulus,
      lifeId,
      plan: {
        ...planShape,
        shouldEnterDialogue: false,
        shouldUpdateMemory: true,
        shouldUpdateBond: true,
        shouldUpdateHomeostasis: true,
        shouldScheduleFollowup: false,
      },
      currentUserContent: wakeSummary,
      metadata: { source: 'elysia-ai-behavior', triggerSource: source },
    })

    return {
      stimulus,
      lifeId,
      userMessage,
      summary: wakeSummary,
      tools,
      resolveOutput: (loop) => resolveWakeOutput(toolState, loop),
      statePlan,
      source,
      reason,
      lastEvent,
      packsSnapshot: [],
    }
  }

  // ── execute 分支：状态更新 + 对话指令 ──
  const executeWakeArtifact = async (
    artifact: WakeArtifact,
    writeInstruction?: (instruction: BehaviorExecutionInstruction) => void,
  ): Promise<void> => {
    const { stimulus, lifeId, userMessage, summary, tools, resolveOutput, statePlan, source, reason, lastEvent } = artifact

    // 契约补齐：plan 交给执行器前发射 plan.created 事实事件（observatory 可见）。
    await eventBus.emit('behavior.execution.plan.created', { planId: statePlan.id, plan: statePlan })

    if (runtime.behaviorExecution) {
      try {
        await runtime.behaviorExecution.execute(statePlan)
      } catch (error) {
        // 状态更新（memory/bond/homeostasis）失败不阻断对话指令：
        // 唤醒的首要出口是 instruction，执行器侧已有自己的 failed 事件。
        logger.error('behaviorExecution.execute failed; instruction still emitted', error, {
          plugin: 'elysia-ai-behavior',
          phase: 'execute',
          planId: statePlan.id,
          stimulusId: stimulus.id,
        })
      }
    }

    const instruction: BehaviorExecutionInstruction = {
      lifeId,
      stimulusId: stimulus.id,
      plan: {
        scope: { type: 'habitat', key: stimulus.habitatId },
        sourceStimulusIds: [stimulus.id],
        mode: 'send-to-ai',
        plannerSource: 'program',
        shouldEnterDialogue: true,
        shouldUpdateMemory: false,
        shouldUpdateBond: false,
        shouldUpdateHomeostasis: false,
        shouldScheduleFollowup: false,
        reason: `trigger:${source}:${reason}`,
      },
      actions: [
        {
          type: 'dialogue',
          task: {
            lifeId,
            habitatId: stimulus.habitatId,
            scope: { type: 'habitat', key: stimulus.habitatId },
            sourceStimulusIds: [stimulus.id],
            mode: 'reply-now',
            messages: [],
            metadata: {
              currentUserContent: userMessage,
              historySummary: summary,
              // W2-12：对话任务的 actorId 同样只在 instant 时取 lastEvent——
              // 定时/手动/批量唤醒归因到最后说话者会让下游记忆链路错配。
              actorId: source === 'instant' ? (lastEvent?.actorId ?? stimulus.actorId) : undefined,
              triggerSource: source,
              triggerReason: reason,
              agentic: {
                tools,
                resolveOutput,
                maxRounds: 6,
              },
              routing: {
                platform: stimulus.platform,
                botId: stimulus.botId,
                guildId: stimulus.guildId,
                channelId: stimulus.channelId,
              },
            },
          },
        },
      ],
    }

    logger.debug('emitting behavior.instruction (agentic wake)', {
      plugin: 'elysia-ai-behavior',
      phase: 'execute',
      stimulusId: instruction.stimulusId,
      lifeId,
      triggerSource: source,
    })

    writeInstruction?.(instruction)
    await eventBus.emit('behavior.instruction', { instruction })
  }

  // ── 普通刺激：三层分发的③事件累积（①指令/②即时在 Phase 3 接入）──
  const ingestForLife = (stimulus: Stimulus, lifeId: string): void => {
    // 记录 habitat 路由信息（合成触发刺激与发送目标解析用）
    if (stimulus.platform || stimulus.channelId || stimulus.guildId || stimulus.botId) {
      habitatRouting.set(stimulus.habitatId, {
        platform: stimulus.platform,
        botId: stimulus.botId,
        guildId: stimulus.guildId,
        channelId: stimulus.channelId,
        isDirectMessage: stimulus.isDirectMessage,
      })
    }

    if (!cognition) return
    // 事件已在 cognition 阶段入账；此处取同刺激的目录事件做三层分发
    // （enabledEvents 关闭的类型 cognition 未记录 → 不参与分发，语义一致）。
    const recent = cognition.getRecentEvents(lifeId, stimulus.habitatId, 3)
    const event = recent.find((item) => item.stimulusId === stimulus.id)
    if (!event) return

    // 多 life 去重：指令/即时的副作用（回执发送、即时唤醒）按刺激全局只执行一次——
    // 同一刺激对象被投影路由到 N 个 life，第一个 life 消费后标记，其余 life 跳过分发。
    if (stimulus.metadata?.dispatchConsumed) {
      logger.debug('dispatch already consumed by another life; skipping', {
        plugin: 'elysia-ai-behavior',
        phase: 'dispatch',
        stimulusId: stimulus.id,
        lifeId,
      })
      return
    }

    // ① 指令直达：零 LLM 成本；无权限/冷却中不拦截（事件下行，模型可见）
    if (commandSystem.handle(event, (result, ev) => {
      markDispatchConsumed(stimulus)
      dispatchCommandExecuted(result, ev, lifeId)
    })) {
      logger.debug('command consumed event', {
        plugin: 'elysia-ai-behavior',
        phase: 'dispatch',
        stimulusId: stimulus.id,
        eventKey: event.key,
      })
      return
    }

    // ② 即时应对：规则命中 → 模板直发 / 插队唤醒
    const instantMatch = instantEngine.match(event)
    if (instantMatch) {
      const { item, match } = instantMatch
      if (item.action.type === 'llm') {
        instantEngine.consumeCooldown(item, event.habitatId)
        fireTrigger({
          lifeId,
          habitatId: stimulus.habitatId,
          source: 'instant',
          reason: `规则:${item.name}`,
          directive: item.action.directive,
          events: [event],
        })
      } else {
        void (async () => {
          const action = item.action as { type: 'send-text'; template: string }
          // 模板直发是跨 life 共享副作用（同 habitat 只发一次）：消费标记防多 life 重复发送
          markDispatchConsumed(stimulus)
          const text = instantEngine.expand(action, event, match)
          const sent = await sendTextToHabitat(stimulus.habitatId, text)
          // 全部被限流/禁用跳过时不消耗冷却（下个事件还能触发）
          if (sent) instantEngine.consumeCooldown(item, event.habitatId)
          if (item.announceToFeed !== false) {
            announceSystemEvent(lifeId, stimulus.habitatId, 'system.instant.sent', {
              rule: item.name,
              content: sent ? text : '（回复未发出）',
              actorName: event.actorName,
              actorId: event.actorId,
            })
          }
        })()
      }
      return
    }

    // ③ 密度合并：攒批等唤醒
    const scope = getScope(lifeId, stimulus.habitatId, stimulus.isDirectMessage === true)
    scope.batcher.push(event)
  }

  // ── 装配：kernel 管线阶段钩子（主链单轨：decide 写 artifact，execute 执行）──
  const NS_BEHAVIOR_ARTIFACT = 'behavior.wake-artifact'
  const pipeline = runtime.context.pipeline
  const disposers: Array<() => void> = []

  disposers.push(pipeline.registerHook({
    stage: STAGE_BEHAVIOR_DECIDE,
    owner: 'elysia-ai-behavior',
    run(pctx) {
      const { stimulus, lifeId } = pctx.core as { stimulus: Stimulus, lifeId: string }
      if (stimulus.metadata?.triggerSource) {
        // 触发刺激只为目标 life 唤醒：默认投影会把合成刺激路由到同 habitat
        // 的全部 active life，不校验会导致一次点火在多 life 下被放大。
        if (stimulus.lifeId && stimulus.lifeId !== lifeId) return
        const artifact = buildWakeArtifact(stimulus, lifeId)
        pctx.write(NS_BEHAVIOR_ARTIFACT, artifact)
        return
      }
      ingestForLife(stimulus, lifeId)
    },
  }))
  disposers.push(pipeline.registerHook({
    stage: STAGE_BEHAVIOR_EXECUTE,
    owner: 'elysia-ai-behavior',
    async run(pctx) {
      const artifact = pctx.read<WakeArtifact>(NS_BEHAVIOR_ARTIFACT)
      if (!artifact) return
      await executeWakeArtifact(artifact, (instruction) => {
        pctx.write(NS_BEHAVIOR, instruction)
      })
    },
  }))

  // 合并器轮询：200ms tick 驱动 quiet/max-wait 两条到期路径
  const ticker = setInterval(() => {
    for (const scope of scopes.values()) {
      try {
        scope.batcher.tick()
      } catch (error) {
        logger.error('batcher tick failed', error, {
          plugin: 'elysia-ai-behavior',
          phase: 'tick',
        })
      }
    }
  }, TICK_MS)
  ticker.unref?.()

  return {
    service,
    dispose() {
      clearInterval(ticker)
      triggerManager.stop()
      for (const dispose of disposers) dispose()
      habitatRouting.clear()
      scopes.clear()
      logger.info('behavior plugin disposed', {
        plugin: 'elysia-ai-behavior',
        phase: 'dispose',
      })
    },
  }
}
