import type {
  BehaviorExecutionPlan,
  Stimulus,
  TriggerEvent,
  TriggerWakeSource,
} from '@elysia-ai/core'
import { DEFAULT_INSTANT_RULES } from '@elysia-ai/trigger'
import type { CommandItem, EventsPackEntry, InstantItem } from '@elysia-ai/trigger'

/**
 * behavior（行动层）配置：事件密度处理 + pack 记忆。
 * 指令（commands）与即时规则（instantRules）在 Phase 3 追加。
 */
export interface Config {
  /** 出声总闸：关闭后触发唤醒被压制（只观察不出声）。 */
  enableReply: boolean
  batcher: {
    /** 群聊静默窗口：距最近事件静默该时长即触发 LLM 唤醒 */
    quietWindowMs: number
    /** 私聊静默窗口（近即时；私聊一问一答不应久等） */
    dmQuietWindowMs: number
    /** 批最大等待；0 = 不设（防热闹时段永不触发） */
    maxWaitMs: number
    /** 密度统计窗口 */
    densityWindowMs: number
    /** 密度阈值：窗口内事件数达标即触发；0 = 不启用 */
    densityThreshold: number
    /** 单批条数上限；0 = 不限 */
    maxBatch: number
  }
  packMemory: {
    /** 存档最近 N 次触发时的 events pack */
    maxPacks: number
    /** 唤醒提示注入最近 N 次 pack（0 = 关闭变量注入） */
    injectPacks: number
  }
  /** 指令直达（第一层：零 LLM 成本）。 */
  commands: CommandItem[]
  /** 即时应对规则（第二层；缺省为被@必应、私聊必应）。 */
  instantRules: InstantItem[]
  /** 定时触发器（第四层：与即时响应同等地位）。 */
  triggers: {
    enabled: boolean
    adminWhitelist: string[]
    maxTasksPerOwner: number
    /** 存储模式：auto = runtime 开启 mongo 时自动持久化，否则内存；memory = 强制内存 */
    repository: 'auto' | 'memory'
  }
}

export const DEFAULT_CONFIG: Config = {
  enableReply: true,
  batcher: {
    quietWindowMs: 8_000,
    dmQuietWindowMs: 1_500,
    maxWaitMs: 30_000,
    densityWindowMs: 10_000,
    densityThreshold: 15,
    maxBatch: 50,
  },
  packMemory: {
    maxPacks: 12,
    injectPacks: 2,
  },
  commands: [],
  instantRules: DEFAULT_INSTANT_RULES,
  triggers: { enabled: true, adminWhitelist: [], maxTasksPerOwner: 20, repository: 'auto' },
}

/** habitat → 平台路由信息（合成触发刺激与发送目标解析用）。 */
export interface HabitatRouting {
  platform?: string
  botId?: string
  guildId?: string
  channelId?: string
  isDirectMessage?: boolean
}

/** 唤醒工件：decide 阶段产出、execute 阶段消费（管线内交接）。 */
export interface WakeArtifact {
  stimulus: Stimulus
  lifeId: string
  /** 唤醒提示（指令 + 事件清单 + pack 注入），dialogue currentUserContent（仅本轮输入） */
  userMessage: string
  /** 一行摘要：入 episodic 记忆与对话史（historySummary），避免全文随 memoryLimit 反复重放 */
  summary: string
  /** agentic 工具集（send_reply/stay_silent/get_event_history） */
  tools: import('@elysia-ai/brain').BrainToolEntry[]
  /** 从工具循环结果导出输出段与沉默决策 */
  resolveOutput: (loop: import('@elysia-ai/brain').ToolLoopResult) => {
    segments: string[]
    silent: boolean
    silentReason?: string
  }
  /** 唤醒后状态更新（memory/bond/homeostasis） */
  statePlan: BehaviorExecutionPlan
  source: TriggerWakeSource
  reason: string
  lastEvent?: TriggerEvent
  packsSnapshot: EventsPackEntry[]
}
