import type {
  BehaviorExecutionAction,
  BehaviorExecutionPlan,
  BehaviorExecutionPlannerInput,
  DialogueTask,
} from '@elysia-ai/core'

function createId(prefix: string, now: number): string {
  return `${prefix}-${now}-${Math.random().toString(36).slice(2, 10)}`
}

function createAction(
  type: BehaviorExecutionAction['type'],
  priority: number,
  payload: Record<string, unknown>,
  now: number,
  maxAttempts: number,
  metadata?: Record<string, unknown>,
): BehaviorExecutionAction {
  return {
    id: createId(`action-${type}`, now),
    type,
    status: 'pending',
    priority,
    payload,
    attempts: 0,
    maxAttempts,
    createdAt: now,
    metadata,
  }
}

function buildDialogueTask(input: BehaviorExecutionPlannerInput): DialogueTask {
  const mode: DialogueTask['mode'] = input.plan.mode === 'program-direct' || input.plan.mode === 'send-to-ai'
    ? 'reply-now'
    : input.plan.mode === 'buffer'
      ? 'defer'
      : input.plan.mode === 'internal-update-only'
        ? 'internal-update-only'
        : 'silent-update'

  return {
    scope: input.plan.scope,
    sourceStimulusIds: input.plan.sourceStimulusIds,
    mode,
    habitatId: input.stimulus.habitatId,
    messages: [
      {
        role: 'system',
        content: `Generate a dialogue response for scope "${input.plan.scope.type}".`,
        metadata: {
          source: 'elysia-ai-behavior-execution-plan',
          mode: input.plan.mode,
          plannerSource: input.plan.plannerSource,
          reason: input.plan.reason,
        },
      },
    ],
    metadata: {
      plannerSource: input.plan.plannerSource,
      mode: input.plan.mode,
      currentUserContent: input.currentUserContent,
      actorId: input.stimulus.actorId,
      threadId: input.stimulus.threadId,
      behaviorExecution: true,
      shouldUpdateMemory: input.plan.shouldUpdateMemory,
      shouldUpdateBond: input.plan.shouldUpdateBond,
      shouldUpdateHomeostasis: input.plan.shouldUpdateHomeostasis,
      shouldScheduleFollowup: input.plan.shouldScheduleFollowup,
      reason: input.plan.reason,
    },
  }
}

function stimulusSummary(input: BehaviorExecutionPlannerInput): string | undefined {
  const content = input.stimulus.payload['content']
  return typeof content === 'string' ? content : undefined
}

export function createBehaviorExecutionPlan(input: BehaviorExecutionPlannerInput): BehaviorExecutionPlan {
  const now = input.now ?? Date.now()
  const maxAttempts = input.actionMaxAttempts ?? 1
  const actions: BehaviorExecutionAction[] = []

  if (input.plan.shouldEnterDialogue) {
    actions.push(createAction(
      'dialogue',
      100,
      {
        task: buildDialogueTask(input),
      },
      now,
      maxAttempts,
      {
        reason: input.plan.reason,
      },
    ))
  }

  if (input.plan.shouldUpdateMemory) {
    actions.push(createAction(
      'memory-update',
      60,
      {
        request: {
          id: createId('memory-update', now),
          stimulusId: input.stimulus.id,
          lifeId: input.lifeId,
          actorId: input.stimulus.actorId,
          habitatId: input.stimulus.habitatId,
          threadId: input.stimulus.threadId,
          // W3：scope 提示与 inferOwnerType 实际推断对齐——无 actorId 时记忆
          // 归 habitat 级（此前 'life' 与实际 ownerType 不一致会误导下游提示）。
          scope: input.stimulus.actorId ? 'actor' : 'habitat',
          kind: 'episodic',
          // 唤醒场景 stimulus.payload.content 可能只有指令或为空：
          // 记忆内容优先用唤醒摘要（currentUserContent），避免落入
          // "Memory update from stimulus <id>" 无信息量占位串。
          content: input.currentUserContent ?? stimulusSummary(input),
          stimulusSummary: stimulusSummary(input),
          decisionSummary: input.plan.reason,
          createdAt: now,
          metadata: {
            plannerSource: input.plan.plannerSource,
          },
        },
      },
      now,
      maxAttempts,
      {
        reason: input.plan.reason,
      },
    ))
  }

  if (input.plan.shouldUpdateBond) {
    actions.push(createAction(
      'bond-update',
      50,
      {
        request: {
          id: createId('bond-update', now),
          stimulusId: input.stimulus.id,
          lifeId: input.lifeId,
          targetId: input.stimulus.actorId ?? input.stimulus.habitatId ?? input.lifeId,
          targetType: input.stimulus.actorId ? 'actor' : input.stimulus.habitatId ? 'habitat' : 'life',
          actorId: input.stimulus.actorId,
          habitatId: input.stimulus.habitatId,
          threadId: input.stimulus.threadId,
          createdAt: now,
        },
      },
      now,
      maxAttempts,
      {
        reason: input.plan.reason,
      },
    ))
  }

  if (input.plan.shouldUpdateHomeostasis) {
    actions.push(createAction(
      'homeostasis-update',
      40,
      {
        request: {
          id: createId('homeostasis-update', now),
          stimulusId: input.stimulus.id,
          lifeId: input.lifeId,
          reason: input.plan.reason,
          delta: {
            energy: -0.02,
            sociability: input.plan.shouldEnterDialogue ? -0.01 : 0,
            curiosity: input.plan.shouldScheduleFollowup ? 0.02 : 0,
          },
          source: {
            stimulusId: input.stimulus.id,
          },
          createdAt: now,
        },
      },
      now,
      maxAttempts,
      {
        reason: input.plan.reason,
      },
    ))
  }

  if (actions.length === 0) {
    actions.push(createAction(
      'noop',
      0,
      {
        reason: input.plan.reason,
      },
      now,
      1,
      {
        reason: input.plan.reason,
      },
    ))
  }

  return {
    id: createId('behavior-execution-plan', now),
    stimulusId: input.stimulus.id,
    lifeId: input.lifeId,
    habitatId: input.stimulus.habitatId,
    actorId: input.stimulus.actorId,
    threadId: input.stimulus.threadId,
    channelId: input.stimulus.channelId,
    platform: input.stimulus.platform,
    botId: input.stimulus.botId,
    scope: input.plan.scope,
    scopeKey: input.plan.scope.key,
    plan: input.plan,
    actions: actions.sort((a, b) => b.priority - a.priority),
    priority: 0,
    status: 'pending',
    createdAt: now,
    metadata: input.metadata,
  }
}
