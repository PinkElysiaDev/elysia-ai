import type { Stimulus } from '@elysia-ai/core'
import type { BehaviorPlanningContext, StimulusScope } from './types.js'

function resolveThreadId(
  stimulus: Stimulus,
  context: BehaviorPlanningContext
): string | undefined {
  if (stimulus.threadId) return stimulus.threadId

  const payloadThreadId =
    typeof stimulus.payload?.threadId === 'string'
      ? (stimulus.payload.threadId as string)
      : undefined

  if (payloadThreadId) return payloadThreadId
  if (context.threadId) return context.threadId
  return undefined
}

export function resolveStimulusScope(
  stimulus: Stimulus,
  context: BehaviorPlanningContext
): StimulusScope {
  const threadId = resolveThreadId(stimulus, context)

  if (threadId) {
    return {
      type: 'thread',
      key: `${stimulus.habitatId}:${threadId}`,
    }
  }

  if (stimulus.actorId) {
    return {
      type: 'user',
      key: `${stimulus.habitatId}:${stimulus.actorId}`,
    }
  }

  if (stimulus.type === 'system' || stimulus.type === 'silence') {
    return {
      type: 'life-global',
      key: 'life-global',
    }
  }

  return {
    type: 'habitat',
    key: stimulus.habitatId,
  }
}
