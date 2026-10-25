import { Schema } from 'koishi'
import { createBehaviorPluginRuntime } from '@elysia-ai/behavior'
import type { Config as BehaviorConfig } from '@elysia-ai/behavior'
import type {
  BehaviorExecutionService,
  BehaviorService,
  CognitionService,
  CoreEventMap,
  EventBus,
  HomeostasisService,
  PersistenceService,
  Stimulus,
} from '@elysia-ai/core'
import { resolveTriggerTaskRepository } from '@elysia-ai/behavior'
import { createElysiaPlugin, getOptionalElysiaService } from '@elysia-ai/shared'
export * from '@elysia-ai/behavior'

type BatcherConfig = Pick<BehaviorConfig['batcher'], 'quietWindowMs' | 'dmQuietWindowMs' | 'maxWaitMs' | 'densityWindowMs' | 'densityThreshold' | 'maxBatch'>
type PackMemoryConfig = Pick<BehaviorConfig['packMemory'], 'maxPacks' | 'injectPacks'>
type BehaviorPluginConfig = Omit<BehaviorConfig, 'batcher' | 'packMemory' | 'commands' | 'instantRules' | 'triggers'> & {
  batcher?: BatcherConfig
  packMemory?: PackMemoryConfig
  commands?: BehaviorConfig['commands']
  instantRules?: BehaviorConfig['instantRules']
  triggers?: Partial<BehaviorConfig['triggers']>
}

export const name = 'elysia-ai-behavior'

// 声明对 runtime 的必需依赖：cordis 会在 elysia.runtime 就绪后再跑本插件 apply。
export const inject = ['elysia.runtime']

export const Config: Schema<BehaviorPluginConfig> = Schema.object({
  enableReply: Schema.boolean().default(true)
    .description('出声总闸。关闭后触发唤醒被压制：生命体只观察记录事件，不唤醒 LLM、不出声。'),
  batcher: Schema.object({
    quietWindowMs: Schema.number().default(8000)
      .description('群聊静默窗口（毫秒）：距最近事件静默该时长即触发一次 LLM 唤醒。这是常规触发路径。'),
    dmQuietWindowMs: Schema.number().default(1500)
      .description('私聊静默窗口（毫秒）：私聊一问一答不应久等，默认近即时。'),
    maxWaitMs: Schema.number().default(30000)
      .description('批最大等待（毫秒）：批首事件起封顶必发，防止热闹时段永不触发。0 = 不设。'),
    densityWindowMs: Schema.number().default(10000)
      .description('密度统计窗口（毫秒）。'),
    densityThreshold: Schema.number().default(15)
      .description('密度阈值：窗口内事件数达到即立即触发（刷屏不再干等静默）。0 = 不启用。'),
    maxBatch: Schema.number().default(50)
      .description('单批条数上限，达到立即触发。0 = 不限。'),
  }).description('密度合并器（何时唤醒 LLM）').collapse(),
  packMemory: Schema.object({
    maxPacks: Schema.number().default(12)
      .description('短期记忆容量：存档最近 N 次触发时的 events pack。'),
    injectPacks: Schema.number().default(2)
      .description('唤醒提示注入最近 N 次 pack（0 = 关闭变量注入，模型仍可用工具回看）。'),
  }).description('短期记忆（events pack 存档）').collapse(),
  commands: Schema.array(Schema.object({
    id: Schema.string().required().description('指令 id（唯一）。'),
    enabled: Schema.boolean().default(true).description('是否启用。'),
    aliases: Schema.array(Schema.string()).required().description('触发词别名（长度优先匹配，如「点歌」）。别名后跟随的剩余文本作为参数，可用 {{content}} 引用。'),
    permission: Schema.object({
      mode: Schema.union([Schema.const('all'), Schema.const('uids')]).default('all').description('all=所有人；uids=白名单。'),
      uids: Schema.array(Schema.string()).description('白名单用户 id。'),
    }).description('权限'),
    cooldown: Schema.object({
      globalMs: Schema.number().default(0).description('全局冷却（毫秒），0=不限。'),
      perUserMs: Schema.number().default(3000).description('每人冷却（毫秒），0=不限。'),
    }).description('冷却'),
    action: Schema.object({
      type: Schema.const('send-text').required(),
      template: Schema.string().required().description('回执模板：{{user}}/{{content}}/{{match.N}} 可用；留空则不回执只入事件清单。'),
    }).description('动作（v1 仅模板直发）'),
    announceToFeed: Schema.boolean().default(true).description('执行结果写入事件清单让模型知情。'),
  })).description('指令直达（零 LLM 成本层）').collapse(),
  instantRules: Schema.array(Schema.object({
    id: Schema.string().required().description('规则 id（唯一）。'),
    name: Schema.string().required().description('规则名（触发原因展示）。'),
    enabled: Schema.boolean().default(true).description('是否启用。'),
    eventKey: Schema.string().required().description('目标事件：mention/message/reply/direct-message/member-added/member-removed/reaction。'),
    condition: Schema.object({
      keywords: Schema.array(Schema.string()).description('内容包含任一关键词（同组 OR）。'),
      regex: Schema.array(Schema.string()).description('正则（任一命中；捕获组供 {{match.N}}）。'),
      startsWith: Schema.array(Schema.string()).description('内容以任一前缀开头。'),
      uids: Schema.array(Schema.string()).description('发起者白名单。'),
    }).description('条件（同组 OR、跨组 AND；全部留空 = 不限）'),
    action: Schema.union([
      Schema.object({
        type: Schema.const('llm').required(),
        directive: Schema.string().description('唤醒定向指令（提示首段）。'),
      }).description('插队唤醒 LLM'),
      Schema.object({
        type: Schema.const('send-text').required(),
        template: Schema.string().required().description('模板直发：{{user}}/{{content}}/{{match.N}} 可用。'),
      }).description('模板直发'),
    ]).description('动作'),
    cooldownMs: Schema.number().default(0).description('每规则冷却（毫秒），0=不限；冷却按群/会话（habitat）隔离，默认规则自带 3 秒冷却防刷屏。'),
    announceToFeed: Schema.boolean().default(true).description('模板直发结果写入事件清单。'),
  })).description('即时应对规则（默认：被@必应、私聊必应）').collapse(),
  triggers: Schema.object({
    enabled: Schema.boolean().default(true).description('启用定时触发器与 LLM 自管理（trigger 工具）。'),
    adminWhitelist: Schema.array(Schema.string()).description('允许管理触发器的用户 id 白名单（koishi authority≥3 自动获得权限）。'),
    maxTasksPerOwner: Schema.number().default(20).description('每用户触发器数量上限。'),
    repository: Schema.union([Schema.const('auto'), Schema.const('memory')]).default('auto')
      .description('任务存储：auto=runtime 开启 mongo（stateRepository: mongo）时自动持久化到 elysia_trigger_tasks 集合，否则内存；memory=强制内存。'),
  }).description('定时触发器').collapse(),
})

export const apply = createElysiaPlugin<
  BehaviorPluginConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
    behaviorExecution?: BehaviorExecutionService
    receiveStimulus(stimulus: Stimulus, options?: { priority?: number }): void
  },
  BehaviorService
>({
  name: 'elysia-ai-behavior',
  serviceFormalName: 'elysia.behavior',
  // kernel 兼容治理：声明身份/服务/挂载阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-behavior',
    version: '0.2.0',
    services: { provides: ['elysia.behavior'], consumes: ['elysia.runtime'] },
    stages: { hooks: ['behavior.decide', 'behavior.execute'] },
    configNamespace: 'behavior',
  },
  build({ ctx, runtime, config, logger }) {
    // cognition（事件注入层）服务：事件清单与历史的来源，可选（缺失时无 feed）。
    // W2-14：apply 时刻解析（非懒解析），缺失必须显式告警——cognition 缺失时
    // 三层分发完全收不到事件清单（唤醒提示无 feed 段），静默降级排查成本高。
    const cognition = getOptionalElysiaService<CognitionService>(ctx, {
      formalName: 'elysia.cognition',
    })
    if (!cognition) {
      logger.warn('cognition 服务未就绪——三层分发将完全不工作（唤醒提示无事件清单）；请确保 elysia-ai-cognition 在 elysia-ai-behavior 之前加载 [plugin=elysia-ai-behavior phase=apply]')
    }
    if (typeof runtime.receiveStimulus !== 'function') {
      logger.error('runtime.receiveStimulus not available; behavior plugin cannot continue', undefined, {
        plugin: 'elysia-ai-behavior',
        phase: 'apply',
      })
      return undefined
    }
    const { batcher, packMemory, commands, instantRules, triggers, ...baseConfig } = config
    // 指令回执/即时模板的发送通道：复用 body 的 sender（habitat 回退）。
    const body = getOptionalElysiaService<{ getSender?(): { send(task: unknown): Promise<void> } }>(ctx, {
      formalName: 'elysia.body',
    })
    const sender = body?.getSender?.()
    if (!sender) {
      // W2-14：info 级即可——仅影响指令回执/即时模板直发，主链路不受损。
      logger.info('body sender 未就绪——指令回执与即时模板直发不可用（事件清单/唤醒不受影响） [plugin=elysia-ai-behavior phase=apply]')
    }
    const sendToHabitat = sender
      ? async (target: { platform?: string, channelId?: string }, content: string): Promise<boolean> => {
          // 防御对齐 behavior 侧 sendTextToHabitat：sender.send 抛错时返回 false
          // （回执未发出不消耗冷却、announce 如实标注），不让上层 fire-and-forget 吞错。
          try {
            await sender.send({ target, content })
            return true
          } catch {
            return false
          }
        }
      : undefined
    // 双模式选择链（Mode B）：auto → elysia.persistence(mongo) 句柄建仓储，否则内存
    const persistence = getOptionalElysiaService<PersistenceService>(ctx, {
      formalName: 'elysia.persistence',
    })
    const { repository: triggerStore } = resolveTriggerTaskRepository({
      repository: triggers?.repository ?? 'auto',
      getPersistence: () => persistence,
      eventBus: runtime.context.eventBus,
      logger,
    })

    // 稳态状态桥（P2-19 读路径）：homeostasis 服务的 getState 是 async，而 behavior
    // 的 getHomeostasis 契约是同步 —— 以 homeostasis.updated 事件维护 per-life 四值
    // 快照缓存（tick 与显式更新都会发该事件）；冷启动缓存未命中时异步 read-through
    // 补填供下次唤醒使用，本次跳过状态段。服务缺失（未装 homeostasis 插件）时
    // 整体不接线，唤醒提示无状态段。
    const homeostasisService = getOptionalElysiaService<HomeostasisService>(ctx, {
      formalName: 'elysia.homeostasis',
    })
    if (!homeostasisService) {
      // W2-14：info 级——仅唤醒提示缺状态段，非功能性损伤。
      logger.info('homeostasis 服务未就绪——唤醒提示将不包含稳态状态段 [plugin=elysia-ai-behavior phase=apply]')
    }
    const homeostasisSnapshots = new Map<string, { energy: number, mood: number, sociability: number, curiosity: number, ts: number }>()
    const recordHomeostasis = (lifeId: string, state: { energy: number, mood: number, sociability: number, curiosity: number, timestamp?: number }) => {
      // W3：read-through 回填带 timestamp 比较——事件乱序/慢查询返回旧态时
      // 不回退缓存（缓存已有更新快照则丢弃迟到的 getState 结果）。
      const ts = state.timestamp ?? 0
      const existing = homeostasisSnapshots.get(lifeId)
      if (existing && existing.ts > ts) return
      homeostasisSnapshots.set(lifeId, {
        energy: state.energy,
        mood: state.mood,
        sociability: state.sociability,
        curiosity: state.curiosity,
        ts,
      })
    }
    const disposeHomeostasisListener = homeostasisService
      ? runtime.context.eventBus.on('homeostasis.updated', ({ lifeInstanceId, state }) => {
          recordHomeostasis(lifeInstanceId, state)
        })
      : undefined
    const getHomeostasis = homeostasisService
      ? (lifeId: string) => {
          const cached = homeostasisSnapshots.get(lifeId)
          if (cached) return cached
          void homeostasisService.getState(lifeId)
            .then((state) => {
              if (state) recordHomeostasis(lifeId, state)
            })
            .catch(() => {
              // 读取失败不影响唤醒：仅本次无状态段
            })
          return undefined
        }
      : undefined

    const pluginRuntime = createBehaviorPluginRuntime({
      runtime: {
        context: runtime.context,
        // priority（vtuber 插队）必须透传：即时唤醒 0 插队、批量/定时 1
        receiveStimulus: (stimulus, options) => runtime.receiveStimulus(stimulus, options),
        behaviorExecution: runtime.behaviorExecution,
      },
      cognition,
      sendToHabitat,
      triggerTaskRepository: triggerStore,
      ...(getHomeostasis ? { getHomeostasis } : {}),
      addReaction: async (target, messageId, emojiId) => {
        // QQ 贴表情：官方 onebot 适配器 6.9.4 起提供 internal.set_msg_emoji_like。
        const bots = ctx.bots as unknown as Array<{
          platform?: string
          selfId?: string
          internal?: Record<string, unknown>
        }>
        const bot = bots.find((candidate) =>
          candidate.platform === target.platform && String(candidate.selfId) === target.botId)
        const setReaction = (bot?.internal as {
          setMsgEmojiLike?: (messageId: string, emojiId: string, set?: boolean) => Promise<unknown>
        } | undefined)?.setMsgEmojiLike
        if (!bot || typeof setReaction !== 'function') return false
        try {
          await setReaction.call(bot.internal, messageId, emojiId, true)
          return true
        } catch {
          return false
        }
      },
      checkTriggerAdmin: async (actor) => {
        if (!actor.userId || !actor.platform) return false
        try {
          const user = await ctx.database?.getUser(actor.platform, actor.userId)
          return (user?.authority ?? 0) >= 3
        } catch {
          return false
        }
      },
      config: {
        ...baseConfig,
        batcher: { ...batcher },
        packMemory: { ...packMemory },
        commands: commands ?? [],
        // 用户未配置时回落内层默认规则（被@必应/私聊必应）。
        // schemastery 对缺失 array 字段解析为 []（非 undefined）——必须把
        // 空数组转回 undefined，否则 [] 短路内层 ?? 默认（曾两次踩坑回归）。
        instantRules: instantRules !== undefined && instantRules.length > 0 ? instantRules : undefined,
        triggers: {
          enabled: triggers?.enabled ?? true,
          adminWhitelist: triggers?.adminWhitelist ?? [],
          maxTasksPerOwner: triggers?.maxTasksPerOwner ?? 20,
          repository: triggers?.repository ?? 'auto',
        },
      } as BehaviorConfig,
      logger,
    })
    if (!pluginRuntime) return undefined

    // Koishi 管理命令（authority 3）：与 LLM trigger 工具共用管理器
    const manager = pluginRuntime.service.getTriggerManager?.() as
      | {
          list(): Promise<Array<Record<string, unknown>>>
          get(id: string): Promise<Record<string, unknown> | null>
          remove(id: string): Promise<unknown>
          fire(id: string): Promise<unknown>
        }
      | undefined
    if (manager && typeof ctx.command === 'function') {
      ctx.command('elysia.trigger.list', '列出定时触发器', { authority: 3 })
        .action(async () => {
          const tasks = await manager.list()
          if (!tasks.length) return '暂无触发器任务。'
          return tasks.map((task) => `${task.id} | ${task.name} | ${task.enabled ? '启用' : '停用'} | ${String((task.condition as { type?: string } | undefined)?.type ?? '?')}${task.habitatId === '*' ? ' | 广播' : ''}`).join('\n')
        })
      ctx.command('elysia.trigger.get <id:string>', '查看触发器详情', { authority: 3 })
        .action(async (_, id) => {
          const task = await manager.get(id)
          return task ? JSON.stringify(task, null, 2) : `未找到 ${id}`
        })
      ctx.command('elysia.trigger.remove <id:string>', '删除触发器', { authority: 3 })
        .action(async (_, id) => {
          const result = await manager.remove(id) as { error?: string }
          return result?.error ? `失败：${result.error}` : `已删除 ${id}`
        })
      ctx.command('elysia.trigger.fire <id:string>', '立即试跑触发器', { authority: 3 })
        .action(async (_, id) => {
          const result = await manager.fire(id) as { error?: string }
          return result?.error ? `失败：${result.error}` : `已触发 ${id}`
        })
    }
    return {
      service: pluginRuntime.service,
      dispose() {
        disposeHomeostasisListener?.()
        pluginRuntime.dispose()
      },
    }
  },
})
