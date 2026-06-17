import type {
  CoreEventMap,
  EventBus,
  HomeostasisDelta,
  HomeostasisService,
  HomeostasisState,
  LifeInstance,
  LifeStateRepository,
} from '@elysia-ai/core'

export const internalName = 'elysia-ai-homeostasis'

export interface Config {
  initialEnergy: number
  initialMood: number
  initialSociability: number
  initialCuriosity: number
  energyDecayPerTick: number
  moodDecayPerTick: number
  sociabilityDecayPerTick: number
  curiosityDecayPerTick: number
  maxValue: number
  minValue: number
  responseThresholdMin: number
  responseThresholdMax: number
  restoreOnStartup: boolean
  // 【D3-1 恢复动力学】各指标的静息基线：tick 时指标朝基线移动而非单向衰减到 0。
  // 高于基线则向下衰减，低于基线则向上恢复（idle 恢复）。默认取初始值。
  energyBaseline?: number
  moodBaseline?: number
  sociabilityBaseline?: number
  curiosityBaseline?: number
  // 低于基线时的恢复速率相对衰减速率的倍率（idle 恢复通常比衰减慢，默认 0.5）。
  recoveryFactor?: number
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 绋虫€佽绠?// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function computeThreshold(energy: number, mood: number, sociability: number, config: Config): number {
  // 褰撹兘閲忋€佸績鎯呫€佺ぞ浜ゅ€惧悜閮介珮鏃堕檷浣庨槇鍊硷紙鏇存効鎰忓搷搴旓�?
  const baseThreshold = (1 - energy) * 0.4 + (1 - mood) * 0.3 + (1 - sociability) * 0.3
  return clamp(baseThreshold, config.responseThresholdMin, config.responseThresholdMax)
}

/**
 * 【D3-1】单指标朝基线移动一步：
 *   - 当前值 > 基线 → 向下衰减 decayRate
 *   - 当前值 < 基线 → 向上恢复 decayRate * recoveryFactor（idle 恢复，通常更慢）
 *   - 不会越过基线（移动量钳到与基线的距离），避免在基线附近来回振荡。
 */
function relaxTowardBaseline(current: number, baseline: number, decayRate: number, recoveryFactor: number): number {
  if (current > baseline) return Math.max(baseline, current - decayRate)
  if (current < baseline) return Math.min(baseline, current + decayRate * recoveryFactor)
  return current
}

function createInitialState(lifeInstanceId: string, config: Config, timestamp: number): HomeostasisState {
  return {
    lifeInstanceId,
    timestamp,
    energy: config.initialEnergy,
    mood: config.initialMood,
    sociability: config.initialSociability,
    curiosity: config.initialCuriosity,
    responseThreshold: computeThreshold(config.initialEnergy, config.initialMood, config.initialSociability, config),
  }
}

function tick(
  state: HomeostasisState,
  config: Config,
  reason: string,
  timestamp: number,
  rebound = 0,
): { state: HomeostasisState; delta: HomeostasisDelta } {
  const prevState = { ...state }

  const recoveryFactor = config.recoveryFactor ?? 0.5
  const energyBaseline = config.energyBaseline ?? config.initialEnergy
  const moodBaseline = config.moodBaseline ?? config.initialMood
  const sociabilityBaseline = config.sociabilityBaseline ?? config.initialSociability
  const curiosityBaseline = config.curiosityBaseline ?? config.initialCuriosity

  // 【D3-1】先朝基线松弛（idle 恢复/衰减），再叠加正向交互回升，最后钳到 [min,max]。
  const newEnergy = clamp(
    relaxTowardBaseline(state.energy, energyBaseline, config.energyDecayPerTick, recoveryFactor) + rebound,
    config.minValue, config.maxValue,
  )
  const newMood = clamp(
    relaxTowardBaseline(state.mood, moodBaseline, config.moodDecayPerTick, recoveryFactor) + rebound,
    config.minValue, config.maxValue,
  )
  const newSociability = clamp(
    relaxTowardBaseline(state.sociability, sociabilityBaseline, config.sociabilityDecayPerTick, recoveryFactor) + rebound,
    config.minValue, config.maxValue,
  )
  const newCuriosity = clamp(
    relaxTowardBaseline(state.curiosity, curiosityBaseline, config.curiosityDecayPerTick, recoveryFactor),
    config.minValue, config.maxValue,
  )

  const newState: HomeostasisState = {
    lifeInstanceId: state.lifeInstanceId,
    timestamp,
    energy: newEnergy,
    mood: newMood,
    sociability: newSociability,
    curiosity: newCuriosity,
    responseThreshold: computeThreshold(newEnergy, newMood, newSociability, config),
  }

  const delta: HomeostasisDelta = {
    lifeInstanceId: state.lifeInstanceId,
    energy: newEnergy - prevState.energy,
    mood: newMood - prevState.mood,
    sociability: newSociability - prevState.sociability,
    curiosity: newCuriosity - prevState.curiosity,
    responseThreshold: newState.responseThreshold - prevState.responseThreshold,
    reason,
  }

  return { state: newState, delta }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Plugin apply
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type HomeostasisLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface HomeostasisPluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap> }
    stateRepository: LifeStateRepository<HomeostasisState>
    homeostasisService: HomeostasisService
    lifeRegistry: { getAll(): LifeInstance[] }
  }
  config: Config
  logger: HomeostasisLoggerLike
}

export interface HomeostasisPluginRuntime {
  service: HomeostasisService
  dispose(): void
}

export function createHomeostasisPluginRuntime(options: HomeostasisPluginRuntimeOptions): HomeostasisPluginRuntime {
  const { runtime, config, logger } = options

  logger.info('homeostasis plugin apply started', {
    plugin: 'elysia-ai-homeostasis',
    phase: 'apply',
  })

  const eventBus = runtime.context.eventBus
  const repo = runtime.stateRepository
  // 注：D3-1 起 tick 仅作用于被路由的生命，不再遍历 lifeRegistry.getAll()。
  // runtime.lifeRegistry 仍由 options 契约保留，供未来全量维护场景使用。

  const disposeLifeLoaded = eventBus.on('life.loaded', async ({ lifeId }) => {
    if (config.restoreOnStartup) {
      const restored = await repo.getByLifeInstanceId(lifeId)
      if (restored) {
        logger.info('homeostasis state restored from repository', {
          plugin: 'elysia-ai-homeostasis',
          phase: 'init',
          lifeInstanceId: lifeId,
          state: restored,
        })
        return
      }
    }

    const initialState = createInitialState(lifeId, config, Date.now())
    await repo.save(lifeId, initialState)

    logger.info('homeostasis state initialized', {
      plugin: 'elysia-ai-homeostasis',
      phase: 'init',
      lifeInstanceId: lifeId,
      state: initialState,
    })
  })

  // 【D3-1】tick 挂在 projection.routed 上：该事件直接带被路由的 lifeIds，
  // 且在管线中是"生命被激活"的时点（早于 perception）。tick 实现 idle 恢复/衰减动力学，
  // 仅作用于被路由的生命，不再遍历 lifeRegistry.getAll() 全量空转。
  // 注：sentiment 驱动的正向回升由 behavior 层经 behavior.homeostasis.update.requested
  // 显式请求（runtime homeostasis service 已消费该事件），那是 sentiment-aware 的正确入口。
  const disposeProjectionRouted = eventBus.on('projection.routed', async ({ stimulusId, routing }) => {
    const routedLifeIds = routing.lifeIds
    if (!routedLifeIds || routedLifeIds.length === 0) {
      logger.debug('homeostasis tick skipped: no routed life for stimulus', {
        plugin: 'elysia-ai-homeostasis',
        phase: 'tick',
        stimulusId,
      })
      return
    }

    for (const lifeId of routedLifeIds) {
      const state = await repo.getByLifeInstanceId(lifeId)
      if (!state) {
        logger.debug('homeostasis tick skipped: no state found for life', {
          plugin: 'elysia-ai-homeostasis',
          phase: 'tick',
          lifeInstanceId: lifeId,
          stimulusId,
        })
        continue
      }

      const timestamp = Date.now()
      const { state: newState, delta } = tick(state, config, `stimulus.${stimulusId}`, timestamp)

      await repo.save(lifeId, newState)

      logger.debug('homeostasis tick', {
        plugin: 'elysia-ai-homeostasis',
        phase: 'tick',
        lifeInstanceId: lifeId,
        stimulusId,
        delta,
        state: newState,
      })

      await eventBus.emit('homeostasis.updated', {
        lifeInstanceId: lifeId,
        state: newState,
        delta,
      })
    }
  })

  return {
    service: runtime.homeostasisService,
    dispose() {
      disposeLifeLoaded()
      disposeProjectionRouted()
      logger.info('homeostasis plugin disposed', {
        plugin: 'elysia-ai-homeostasis',
        phase: 'dispose',
      })
    },
  }
}

