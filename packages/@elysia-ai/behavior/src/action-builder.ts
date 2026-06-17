import type {
  BehaviorAction,
  BehaviorExecutionInstruction,
  DialogueMessage,
  DialogueTask,
  ResponsePlan,
} from '@elysia-ai/core'
import type { StimulusScope } from './types.js'

/**
 * 将 ResponsePlan.mode 映射为 DialogueTask.mode
 *
 * 映射规则：
 * - program-direct / send-to-ai → 立即回复（reply-now）
 * - buffer → 延迟处理（defer）
 * - discard → 静默更新（silent-update）
 * - internal-update-only → 仅内部更新（internal-update-only）
 */
function mapPlanModeToDialogueMode(
  mode: ResponsePlan['mode']
): DialogueTask['mode'] {
  switch (mode) {
    case 'program-direct':
    case 'send-to-ai':
      return 'reply-now'
    case 'buffer':
      return 'defer'
    case 'internal-update-only':
      return 'internal-update-only'
    case 'discard':
    default:
      return 'silent-update'
  }
}

/**
 * 为 DialogueTask 构造默认的系统消息
 *
 * 当前阶段仅包含最小 system prompt，后续 Phase 2/3
 * 将由 persona / memory 层注入富上下文。
 */
function createDefaultSystemMessages(plan: ResponsePlan): DialogueMessage[] {
  return [
    {
      role: 'system',
      content: `Generate a dialogue response for scope "${plan.scope.type}".`,
      metadata: {
        source: 'elysia-ai-behavior',
        mode: plan.mode,
        plannerSource: plan.plannerSource,
        reason: plan.reason,
      },
    },
  ]
}

/**
 * 将 StimulusScope 转换为 core 层 BehaviorScope
 *
 * 两者结构相同但类型名不同，此函数确保显式转换。
 */
function scopeToCore(scope: StimulusScope): ResponsePlan['scope'] {
  return {
    type: scope.type,
    key: scope.key,
  }
}

/**
 * 根据 ResponsePlan 构建 BehaviorAction 列表
 *
 * 每个 plan 展开为一个或多个 action，当前阶段每 plan 返回一个 action。
 * 保留 action 列表结构是为了支持未来并行执行（如同时 dialogue + memory-update）。
 */
export function buildActions(plan: ResponsePlan, currentUserContent?: string): BehaviorAction[] {
  const actions: BehaviorAction[] = []

  if (plan.shouldEnterDialogue) {
    const task: DialogueTask = {
      scope: scopeToCore(plan.scope),
      sourceStimulusIds: plan.sourceStimulusIds,
      mode: mapPlanModeToDialogueMode(plan.mode),
      messages: createDefaultSystemMessages(plan),
      metadata: {
        plannerSource: plan.plannerSource,
        mode: plan.mode,
        currentUserContent,
        shouldUpdateMemory: plan.shouldUpdateMemory,
        shouldUpdateBond: plan.shouldUpdateBond,
        shouldUpdateHomeostasis: plan.shouldUpdateHomeostasis,
        shouldScheduleFollowup: plan.shouldScheduleFollowup,
        reason: plan.reason,
      },
    }
    actions.push({ type: 'dialogue', task })
  } else if (plan.mode === 'buffer') {
    actions.push({ type: 'defer', reason: plan.reason })
  } else if (plan.mode === 'discard') {
    actions.push({ type: 'silent', reason: plan.reason })
  } else {
    // internal-update-only
    actions.push({ type: 'internal-update', reason: plan.reason })
  }

  return actions
}

/**
 * 构造完整的 BehaviorExecutionInstruction
 *
 * 聚合 plan 与 actions，并填入 lifeId / stimulusId 供 runtime 路由。
 * 当前阶段 lifeId 从 scope.key 推导（简化处理），Phase 2 将由 projection 层提供准确映射。
 */
export function buildInstruction(
  lifeId: string,
  stimulusId: string,
  plan: ResponsePlan,
  currentUserContent?: string,
): BehaviorExecutionInstruction {
  const actions = buildActions(plan, currentUserContent)

  return {
    lifeId,
    stimulusId,
    plan: {
      scope: scopeToCore(plan.scope),
      sourceStimulusIds: plan.sourceStimulusIds,
      mode: plan.mode,
      plannerSource: plan.plannerSource,
      shouldEnterDialogue: plan.shouldEnterDialogue,
      shouldUpdateMemory: plan.shouldUpdateMemory,
      shouldUpdateBond: plan.shouldUpdateBond,
      shouldUpdateHomeostasis: plan.shouldUpdateHomeostasis,
      shouldScheduleFollowup: plan.shouldScheduleFollowup,
      reason: plan.reason,
    },
    actions,
  }
}
