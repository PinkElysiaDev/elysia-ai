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
  const followupDelayMs = input.followupDelayMs ?? 60_000
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

  if (input.plan.shouldScheduleFollowup) {
    actions.push(createAction(
      'schedule-followup',
      80,
      {
        request: {
          id: createId('followup-request', now),
          stimulusId: input.stimulus.id,
          lifeId: input.lifeId,
          runAt: now + followupDelayMs,
          delayMs: followupDelayMs,
          stimulus: {
            ...input.stimulus,
            id: `${input.stimulus.id}:followup:${now}`,
            type: 'system',
            timestamp: now + followupDelayMs,
            lifeId: input.lifeId,
            payload: {
              ...input.stimulus.payload,
              content: stimulusSummary(input) ?? 'follow-up stimulus',
              followupOf: input.stimulus.id,
              followupReason: input.plan.reason,
            },
            metadata: {
              ...input.stimulus.metadata,
              generatedBy: 'behavior-execution-plan',
              originalStimulusId: input.stimulus.id,
            },
          },
          reason: input.plan.reason,
          candidateId: input.selectedCandidate?.id,
          decisionId: input.behaviorDecision?.id,
          metadata: input.metadata,
        },
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
          scope: input.stimulus.actorId ? 'actor' : 'life',
          kind: 'episodic',
          content: stimulusSummary(input),
          importance: input.selectedCandidate?.priority,
          salience: input.selectedCandidate?.confidence,
          stimulusSummary: stimulusSummary(input),
          decisionSummary: input.behaviorDecision?.reason ?? input.plan.reason,
          createdAt: now,
          metadata: {
            candidateId: input.selectedCandidate?.id,
            decisionId: input.behaviorDecision?.id,
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
          interactionType: input.selectedCandidate?.type,
          deltaSuggestion: input.selectedCandidate?.confidence,
          createdAt: now,
          metadata: {
            candidateId: input.selectedCandidate?.id,
            decisionId: input.behaviorDecision?.id,
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
            responseThreshold: input.plan.shouldEnterDialogue ? 0.01 : 0,
          },
          source: {
            stimulusId: input.stimulus.id,
          },
          createdAt: now,
          metadata: {
            candidateId: input.selectedCandidate?.id,
            decisionId: input.behaviorDecision?.id,
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
    decisionId: input.behaviorDecision?.id,
    selectedCandidateId: input.selectedCandidate?.id,
    plan: input.plan,
    decision: input.behaviorDecision,
    selectedCandidate: input.selectedCandidate,
    actions: actions.sort((a, b) => b.priority - a.priority),
    priority: input.selectedCandidate?.priority ?? 0,
    status: 'pending',
    createdAt: now,
    metadata: input.metadata,
  }
}
