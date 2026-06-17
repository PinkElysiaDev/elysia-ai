import type {
  BehaviorActionType,
  BehaviorCandidate,
  BehaviorDecision,
} from '@elysia-ai/core'
import { clampPercent } from '@elysia-ai/shared'
import type {
  PlannerSource,
  ProgramRoutingDecision,
  ResponsePlan,
  StimulusScope,
  StimulusSignal,
} from './types.js'
import { createResponsePlan } from './plan.js'

// ─────────────────────────────────────────────────
// Candidate helpers
// ─────────────────────────────────────────────────

function mapDecisionToActionType(decision: ProgramRoutingDecision): BehaviorActionType {
  switch (decision) {
    case 'discard':
      return 'discard'
    case 'buffer':
      return 'defer'
    case 'internal-update-only':
      return 'state-update'
    case 'program-direct':
    case 'send-to-ai':
      return 'reply'
  }
}

function createCandidateId(
  stimulusId: string,
  type: BehaviorActionType,
): string {
  return `${stimulusId}:${type}`
}

function scoreDecision(
  decision: ProgramRoutingDecision,
  signal: StimulusSignal,
): number {
  switch (decision) {
    case 'discard':
      return 100 - signal.responseNecessity
    case 'buffer':
      return signal.bufferPressure + Math.max(0, 80 - signal.directness) * 0.25
    case 'internal-update-only':
      return signal.structuralDeterminability + Math.max(0, 60 - signal.responseNecessity) * 0.25
    case 'program-direct':
      return signal.responseNecessity + signal.structuralDeterminability * 0.25
    case 'send-to-ai':
      return signal.responseNecessity + Math.max(0, 70 - signal.structuralDeterminability) * 0.5
  }
}

// ─────────────────────────────────────────────────
// Candidate generation
// ─────────────────────────────────────────────────

export function createCandidateFromPlan(
  stimulusId: string,
  scope: StimulusScope,
  plan: ResponsePlan,
  signal: StimulusSignal,
): BehaviorCandidate {
  const type = mapDecisionToActionType(plan.mode)
  const priority = clampPercent(scoreDecision(plan.mode, signal))
  const confidence = Math.max(0, Math.min(1, priority / 100))

  return {
    id: createCandidateId(stimulusId, type),
    type,
    scope: {
      type: scope.type,
      key: scope.key,
    },
    sourceStimulusIds: plan.sourceStimulusIds,
    priority,
    confidence,
    reason: plan.reason,
    shouldEnterDialogue: plan.shouldEnterDialogue,
    shouldUpdateMemory: plan.shouldUpdateMemory,
    shouldUpdateBond: plan.shouldUpdateBond,
    shouldUpdateHomeostasis: plan.shouldUpdateHomeostasis,
    shouldScheduleFollowup: plan.shouldScheduleFollowup,
    metadata: {
      mode: plan.mode,
      plannerSource: plan.plannerSource,
      directness: signal.directness,
      responseNecessity: signal.responseNecessity,
      structuralDeterminability: signal.structuralDeterminability,
    },
  }
}

export function generateBehaviorCandidates(
  scope: StimulusScope,
  stimulusId: string,
  decision: ProgramRoutingDecision,
  signal: StimulusSignal,
): BehaviorCandidate[] {
  const primaryPlan = createResponsePlan(scope, stimulusId, decision)
  const primary = createCandidateFromPlan(stimulusId, scope, primaryPlan, signal)

  const candidates = [primary]

  if (decision !== 'discard' && signal.responseNecessity <= 20) {
    const discardPlan = createResponsePlan(scope, stimulusId, 'discard')
    candidates.push(createCandidateFromPlan(stimulusId, scope, discardPlan, signal))
  }

  if (decision !== 'buffer' && signal.bufferPressure >= 60) {
    const bufferPlan = createResponsePlan(scope, stimulusId, 'buffer')
    candidates.push(createCandidateFromPlan(stimulusId, scope, bufferPlan, signal))
  }

  if (decision !== 'internal-update-only' && signal.structuralDeterminability >= 80) {
    const updatePlan = createResponsePlan(scope, stimulusId, 'internal-update-only')
    candidates.push(createCandidateFromPlan(stimulusId, scope, updatePlan, signal))
  }

  return candidates.sort((a, b) => b.priority - a.priority)
}

// ─────────────────────────────────────────────────
// Candidate selection
// ─────────────────────────────────────────────────

export function selectBehaviorCandidate(
  stimulusId: string,
  candidates: BehaviorCandidate[],
  signal: StimulusSignal,
  plannerSource: PlannerSource = 'program',
): BehaviorDecision {
  const selected = candidates[0]

  if (!selected) {
    throw new Error('No behavior candidates generated')
  }

  return {
    id: `${stimulusId}:decision:${selected.type}`,
    selected,
    candidates,
    signal: {
      directness: signal.directness,
      continuity: signal.continuity,
      bondAffinity: signal.bondAffinity,
      bufferPressure: signal.bufferPressure,
      responseNecessity: signal.responseNecessity,
      structuralDeterminability: signal.structuralDeterminability,
    },
    plannerSource,
    decidedAt: Date.now(),
    reason: selected.reason,
    metadata: {
      selectedCandidateId: selected.id,
      candidateCount: candidates.length,
    },
  }
}

export function createResponsePlanFromCandidate(
  candidate: BehaviorCandidate,
  fallbackMode: ProgramRoutingDecision,
): ResponsePlan {
  const mode = typeof candidate.metadata?.mode === 'string'
    ? candidate.metadata.mode as ProgramRoutingDecision
    : fallbackMode

  return {
    scope: {
      type: candidate.scope.type,
      key: candidate.scope.key,
    },
    sourceStimulusIds: candidate.sourceStimulusIds,
    mode,
    plannerSource: typeof candidate.metadata?.plannerSource === 'string'
      ? candidate.metadata.plannerSource as PlannerSource
      : 'program',
    shouldEnterDialogue: candidate.shouldEnterDialogue,
    shouldUpdateMemory: candidate.shouldUpdateMemory,
    shouldUpdateBond: candidate.shouldUpdateBond,
    shouldUpdateHomeostasis: candidate.shouldUpdateHomeostasis,
    shouldScheduleFollowup: candidate.shouldScheduleFollowup,
    reason: candidate.reason,
  }
}
