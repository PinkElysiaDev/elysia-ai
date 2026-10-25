import type {
  CoreEventMap,
  EventBus,
  HomeostasisDelta,
  HomeostasisService,
  HomeostasisState,
  HomeostasisUpdateRequest,
  HomeostasisUpdateResult,
  LifeStateRepository,
} from '@elysia-ai/core'
import { clampUnitOr } from '@elysia-ai/shared'
import type { RuntimeLogger } from '../context/index.js'

function clampMood(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(-1, Math.min(1, value))
}

function defaultState(now: number): HomeostasisState {
  return {
    timestamp: now,
    energy: 0.8,
    mood: 0,
    sociability: 0.5,
    curiosity: 0.5,
  }
}

function resolveDelta(
  current: HomeostasisState,
  request: HomeostasisUpdateRequest,
): HomeostasisDelta {
  const requested = request.delta ?? {}

  return {
    energy: requested.energy ?? 0,
    mood: requested.mood ?? 0,
    sociability: requested.sociability ?? 0,
    curiosity: requested.curiosity ?? 0,
    reason: request.reason,
  }
}

/** W3：归一只挑已知字段——旧文档可能带已退役字段（如 responseThreshold），
 * 透传 spread 会让退役字段在每次 update 后永久残留。 */
function normalizeState(state: HomeostasisState): HomeostasisState {
  return {
    timestamp: state.timestamp,
    energy: state.energy,
    mood: state.mood,
    sociability: state.sociability,
    curiosity: state.curiosity,
    ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
  }
}

function applyDelta(
  current: HomeostasisState,
  delta: HomeostasisDelta,
  request: HomeostasisUpdateRequest,
  now: number,
): HomeostasisState {
  return {
    ...normalizeState(current),
    timestamp: now,
    energy: clampUnitOr(current.energy + delta.energy, current.energy),
    mood: clampMood(current.mood + delta.mood, current.mood),
    sociability: clampUnitOr(current.sociability + delta.sociability, current.sociability),
    curiosity: clampUnitOr(current.curiosity + delta.curiosity, current.curiosity),
    metadata: {
      ...current.metadata,
      ...request.metadata,
      lastHomeostasisUpdateRequestId: request.id,
      lastHomeostasisUpdateReason: request.reason,
      lastHomeostasisUpdateSource: request.source,
      lastHomeostasisUpdatedAt: now,
    },
  }
}

export class DefaultHomeostasisService implements HomeostasisService {
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly repository: LifeStateRepository<HomeostasisState>,
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly logger?: RuntimeLogger,
  ) {}

  start(): void {
    this.disposers.push(
      this.eventBus.on('behavior.homeostasis.update.requested', async (payload) => {
        try {
          const result = await this.update({
            ...payload.request,
            source: {
              ...payload.request.source,
              behaviorPlanId: payload.planId ?? payload.request.source?.behaviorPlanId,
              executionPlanId: payload.planId ?? payload.request.source?.executionPlanId,
              executionActionId: payload.actionId ?? payload.request.source?.executionActionId,
              event: 'behavior.homeostasis.update.requested',
            },
          })

          await this.eventBus.emit('homeostasis.updated', {
            lifeInstanceId: payload.request.lifeId,
            state: result.state,
            delta: result.delta,
            requestId: result.requestId,
            result,
            planId: payload.planId,
            actionId: payload.actionId,
          })
        } catch (error) {
          await this.eventBus.emit('homeostasis.update.failed', {
            requestId: payload.request.id,
            request: payload.request,
            error,
            planId: payload.planId,
            actionId: payload.actionId,
          })

          this.logger?.error('homeostasis update request failed', error, {
            phase: 'homeostasis',
            requestId: payload.request.id,
            lifeId: payload.request.lifeId,
          })
        }
      }),
    )
  }

  stop(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.()
    }
  }

  async getState(lifeId: string): Promise<HomeostasisState | undefined> {
    const state = await this.repository.getByLifeInstanceId(lifeId)
    return state ? normalizeState(state) : undefined
  }

  async update(request: HomeostasisUpdateRequest): Promise<HomeostasisUpdateResult> {
    const now = Date.now()
    const current = await this.repository.getByLifeInstanceId(request.lifeId) ?? defaultState(now)
    const delta = resolveDelta(current, request)
    const state = applyDelta(current, delta, request, now)

    await this.repository.save(request.lifeId, state)

    return {
      requestId: request.id,
      state,
      delta,
      updated: true,
      reason: 'applied-homeostasis-delta',
      metadata: request.metadata,
    }
  }
}
