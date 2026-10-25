import type { HomeostasisService } from './homeostasis.js'
import type { TriggerEvent, TriggerWakeSource } from './events.js'
import type { PerceptionResult } from './perception.js'
import type { Persona, PersonaRegistry } from './persona.js'
import type { Stimulus } from './stimulus.js'

export interface CapabilityDiagnostics {
  plugin: string
  enabled: boolean
  ready: boolean
  serviceName: string
  metadata?: Record<string, unknown>
}

/** behavior 触发唤醒请求：合并器/即时规则/定时任务/手动统一入口。 */
export interface BehaviorTriggerRequest {
  lifeId: string
  habitatId: string
  source: TriggerWakeSource
  /** 触发原因（quiet/density/max-wait/max-batch 或规则/任务名） */
  reason: string
  /** 定向指令（即时规则/定时任务的提示，置于唤醒提示首段） */
  directive?: string
  /** 即时场景携带的命中事件（单条） */
  events?: TriggerEvent[]
  /** 触发目标路由（定时任务冷启动场景；缺省由 behavior 从近期入站刺激回查） */
  routing?: {
    platform?: string
    botId?: string
    guildId?: string
    channelId?: string
  }
}

export interface BehaviorService {
  /** 触发一次 LLM 唤醒（合成触发刺激走完整主链）。 */
  fireTrigger(request: BehaviorTriggerRequest): void
  /** 定时触发器管理器（管理命令/诊断用；triggers.enabled=false 时仍可用） */
  getTriggerManager?(): unknown
  getDiagnostics(): CapabilityDiagnostics
}

export interface PerceptionService {
  process(stimulus: Stimulus): Promise<PerceptionResult>
  getDiagnostics(): CapabilityDiagnostics
}

/**
 * cognition 服务（事件注入层）：维护 per (lifeId × habitatId) 事件历史，
 * 是 events 变量（模型所见事件清单）的唯一数据源。
 */
export interface CognitionService {
  /** 刺激事件入账（按 enabledEvents 配置过滤；合成触发刺激跳过）；返回派生事件或 null。 */
  ingest(stimulus: Stimulus, lifeId: string): TriggerEvent | null
  /** 构建事件清单行（时间升序，末尾最新）。 */
  buildFeed(lifeId: string, habitatId: string, options?: { maxEvents?: number }): string[]
  /** 最近事件（时间升序）；behavior 用于 pack 快照与密度。 */
  getRecentEvents(lifeId: string, habitatId: string, limit?: number): TriggerEvent[]
  getDiagnostics(): CapabilityDiagnostics
}

export interface PersonaService {
  register(persona: Persona): void
  getByLifeId(lifeId: string): Persona | undefined
  getAll(): Persona[]
  getRegistry(): PersonaRegistry
  getDiagnostics(): CapabilityDiagnostics
}

export interface ObservatoryTraceRecord {
  stimulusId: string
  kind: 'stimulus' | 'life'
  lifeId?: string
  root: unknown
  events: unknown[]
  recordedAt: number
}

export interface ObservatoryServiceFacade {
  recordEvent(eventName: string, payload: unknown): void
  queryEvents(query?: Record<string, unknown>): unknown[]
  getSnapshot(): unknown
  getOperationalSnapshot?(): unknown
  /** 最近完成的管线 trace（runtime.trace.completed 汇聚）。 */
  getRecentTraces?(options?: { stimulusId?: string, limit?: number }): ObservatoryTraceRecord[]
  getDiagnostics(): CapabilityDiagnostics
}

export interface BodyService {
  getOutboundRoutes(): unknown
  getHabitatRoutes?(): unknown
  getSender(): unknown
  getDiagnostics(): CapabilityDiagnostics
}

export interface HomeostasisCapabilityService extends HomeostasisService {
  getDiagnostics?(): CapabilityDiagnostics
}

export interface RuntimeCapabilityServiceMap {
  'elysia.behavior': BehaviorService
  'elysia.perception': PerceptionService
  'elysia.cognition': CognitionService
  'elysia.persona': PersonaService
  'elysia.observatory': ObservatoryServiceFacade
  'elysia.body': BodyService
  'elysia.homeostasis': HomeostasisCapabilityService
}
