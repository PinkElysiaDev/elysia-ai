/**
 * Elysia A.I. 领域管线定义（建立在 @elysia-ai/kernel 之上）。
 *
 * "命令走阶段、事实走事件"双轨模型的领域侧：
 * - 阶段（本文件声明）：处理步骤的编排 backbone，插件用
 *   PipelineHook 声明 stage+priority 挂载，runtime 统一调度；
 * - 事件（CoreEventMap）：已发生事实的通知，观测/旁路消费者订阅，
 *   迁移期间所有既有事件发射保持不变。
 *
 * 分段执行模型（对应 runtime 的实际编排）：
 * - 刺激段（每个 stimulus 一次）：stimulus.received → perception
 * - 生命段（每个路由命中的 lifeId 一次）：cognition → behavior.decide →
 *   behavior.execute → dialogue
 * 生命段上下文以刺激段上下文为父链，perception 结果自动可见。
 */

import type { PipelineStage } from '@elysia-ai/kernel'
import { sortStages } from '@elysia-ai/kernel'
import type { ProjectionRoutingResult } from '../types/projection.js'
import type { Stimulus } from '../types/stimulus.js'

/** 领域阶段名常量（第三方用 before/after 挂载相邻位置）。 */
export const STAGE_STIMULUS_RECEIVED = 'stimulus.received'
export const STAGE_PERCEPTION = 'perception'
export const STAGE_COGNITION = 'cognition'
export const STAGE_BEHAVIOR_DECIDE = 'behavior.decide'
export const STAGE_BEHAVIOR_EXECUTE = 'behavior.execute'
export const STAGE_DIALOGUE = 'dialogue'
export const STAGE_SENDER = 'sender'

/** 领域管线阶段声明（before/after 构成 DAG；隐式阶段由第三方钩子引入）。 */
export const ELYSIA_PIPELINE_STAGES: PipelineStage[] = [
  { name: STAGE_STIMULUS_RECEIVED },
  { name: STAGE_PERCEPTION, after: [STAGE_STIMULUS_RECEIVED] },
  { name: STAGE_COGNITION, after: [STAGE_PERCEPTION] },
  { name: STAGE_BEHAVIOR_DECIDE, after: [STAGE_COGNITION] },
  { name: STAGE_BEHAVIOR_EXECUTE, after: [STAGE_BEHAVIOR_DECIDE] },
  { name: STAGE_DIALOGUE, after: [STAGE_BEHAVIOR_EXECUTE] },
  { name: STAGE_SENDER, after: [STAGE_DIALOGUE] },
]

/**
 * 阶段分界锚点：锚点（含）之前为刺激段（每 stimulus 一次），之后为生命段
 * （每个路由命中的 lifeId 一次）。第三方阶段按其拓扑位置自动归段——
 * 例如 after perception/before cognition 的阶段进入刺激段（一次），
 * after dialogue 的阶段进入生命段（每生命一次）。
 */
export const PHASE_BOUNDARY_STAGE = STAGE_COGNITION

/**
 * 按锚点切分**已排序的阶段名序列**：锚点（含）之前为刺激段，之后为生命段。
 * runtime 用 runner.getStageOrder()（含第三方注册阶段）调用本函数，
 * 保证第三方插入的阶段不丢失（Review BUG-1 修复的核心）。
 */
export function splitStageOrder(order: string[]): {
  stimulusPhase: string[]
  lifePhase: string[]
} {
  const boundary = order.indexOf(PHASE_BOUNDARY_STAGE)
  if (boundary === -1) {
    return { stimulusPhase: order, lifePhase: [] }
  }
  return {
    stimulusPhase: order.slice(0, boundary),
    lifePhase: order.slice(boundary),
  }
}

/**
 * 按锚点把阶段表切成刺激段/生命段（保持拓扑序）。
 * 固定清单切分会漏掉第三方插入的阶段（Review BUG-1），此处始终基于
 * 当前全量阶段表动态计算。
 */
export function splitPipelinePhases(stages: PipelineStage[] = ELYSIA_PIPELINE_STAGES): {
  stimulusPhase: string[]
  lifePhase: string[]
} {
  return splitStageOrder(sortStages(stages))
}


/** 刺激段上下文载体。 */
export interface StimulusPhaseCore {
  readonly stimulus: Stimulus
}

/** 生命段上下文载体（生命段上下文以刺激段为 parent）。 */
export interface LifePhaseCore {
  readonly stimulus: Stimulus
  readonly lifeId: string
  readonly routing: ProjectionRoutingResult
}

/** 主链插件写上下文用的命名空间常量（read 端请用同一常量）。 */
export const NS_PERCEPTION = 'perception'
export const NS_BEHAVIOR = 'behavior'
export const NS_DIALOGUE = 'dialogue'
/** dialogue 阶段累积写入的输出列表（sender 阶段逐条发送；兜底路径走 dialogue.output.created 事件）。 */
export const NS_DIALOGUE_OUTPUT = 'dialogue-output'

// ─────────────────────────────────────────────────────────────────────────────
// 服务名单一事实来源
// observatory 等消费者从这里取全表，不再手工维护 13 项硬编码。
// ─────────────────────────────────────────────────────────────────────────────

export interface ElysiaServiceDescriptor {
  /** cordis 服务 id（单名注册；Phase 36 前的 elysia-ai-* 旧名兼容层已于 2026-10 移除）。 */
  formalName: string
  /** 所属层。 */
  layer: string
  /** 中文描述。 */
  description: string
}

export const ELYSIA_SERVICES: readonly ElysiaServiceDescriptor[] = [
  { formalName: 'elysia.runtime', layer: 'runtime', description: '运行时内核（同时提供 elysia.persistence）' },
  { formalName: 'elysia.persistence', layer: 'runtime', description: '持久化集合服务' },
  { formalName: 'elysia.body', layer: 'body', description: '消息输入输出桥接' },
  { formalName: 'elysia.perception', layer: 'perception', description: '刺激感知分析' },
  { formalName: 'elysia.homeostasis', layer: 'homeostasis', description: '内稳态状态' },
  { formalName: 'elysia.cognition', layer: 'cognition', description: '事件注入层（events 变量数据源）' },
  { formalName: 'elysia.persona', layer: 'persona', description: '人格注册表' },
  { formalName: 'elysia.behavior', layer: 'behavior', description: '行动层（三层分发+定时触发器）' },
  { formalName: 'elysia.dialogue', layer: 'dialogue', description: '对话编排' },
  { formalName: 'elysia.brain', layer: 'brain', description: '模型调用大脑' },
  { formalName: 'elysia.modelGateway', layer: 'model-gateway', description: '模型网关' },
  { formalName: 'elysia.memory', layer: 'memory', description: '记忆服务' },
  { formalName: 'elysia.bond', layer: 'bond', description: '关系服务' },
  { formalName: 'elysia.observatory', layer: 'observatory', description: '观测服务' },
]

/** 全部已知服务 id，供 manifest 校验等场景。 */
export const KNOWN_ELYSIA_SERVICE_IDS: readonly string[] = ELYSIA_SERVICES.map(
  (service) => service.formalName,
)
