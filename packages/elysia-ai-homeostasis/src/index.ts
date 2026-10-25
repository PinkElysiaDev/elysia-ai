import { Schema } from 'koishi'
import { createHomeostasisPluginRuntime } from '@elysia-ai/homeostasis'
import type { Config as HomeostasisConfig } from '@elysia-ai/homeostasis'
import type { CoreEventMap, EventBus, HomeostasisService, HomeostasisState, LifeInstance, LifeStateRepository } from '@elysia-ai/core'
import { createElysiaPlugin } from '@elysia-ai/shared'
export * from '@elysia-ai/homeostasis'

type HomeostasisDynamicsConfig = Pick<HomeostasisConfig, 'initialEnergy' | 'initialMood' | 'initialSociability' | 'initialCuriosity' | 'energyDecayPerTick' | 'moodDecayPerTick' | 'sociabilityDecayPerTick' | 'curiosityDecayPerTick' | 'energyBaseline' | 'moodBaseline' | 'sociabilityBaseline' | 'curiosityBaseline' | 'recoveryFactor' | 'maxValue' | 'minValue'>
type HomeostasisPluginConfig = Omit<HomeostasisConfig, keyof HomeostasisDynamicsConfig> & {
  dynamics?: HomeostasisDynamicsConfig
}

export const name = 'elysia-ai-homeostasis'

// 声明对 runtime 的必需依赖：cordis 会在 elysia.runtime 就绪后再跑本插件 apply。
export const inject = ['elysia.runtime']

export const Config: Schema<HomeostasisPluginConfig> = Schema.object({
  restoreOnStartup: Schema.boolean().default(true)
    .description('恢复上次持久化的稳态状态（runtime 重启后重新加载）。'),
  dynamics: Schema.object({
      initialEnergy: Schema.number().default(0.8).description('初始能量（0~1）。'),
    initialMood: Schema.number().default(0.6).description('初始心情（0~1）。'),
    initialSociability: Schema.number().default(0.5).description('初始社交倾向（0~1）。'),
    initialCuriosity: Schema.number().default(0.7).description('初始好奇心（0~1）。'),
    energyDecayPerTick: Schema.number().default(0.01).description('每次状态更新时能量的衰减幅度。'),
    moodDecayPerTick: Schema.number().default(0.005).description('每次状态更新时心情的衰减幅度。'),
    sociabilityDecayPerTick: Schema.number().default(0.003).description('每次状态更新时社交倾向的衰减幅度。'),
    curiosityDecayPerTick: Schema.number().default(0.002).description('每次状态更新时好奇心的衰减幅度。'),
    energyBaseline: Schema.number().description('能量静息基线，留空则取初始能量。指标朝基线松弛而非衰减到 0。'),
    moodBaseline: Schema.number().description('心情静息基线，留空则取初始心情。'),
    sociabilityBaseline: Schema.number().description('社交倾向静息基线，留空则取初始社交倾向。'),
    curiosityBaseline: Schema.number().description('好奇心静息基线，留空则取初始好奇心。'),
    recoveryFactor: Schema.number().default(0.5)
      .description('低于基线时的恢复速率相对衰减速率的倍率（空闲恢复通常更慢）。'),
    maxValue: Schema.number().default(1.0).description('各状态指标的上限。'),
    minValue: Schema.number().default(0.0).description('各状态指标的下限。'),
  }).description('高级：稳态调参').collapse(),
})

export const apply = createElysiaPlugin<
  HomeostasisPluginConfig,
  {
    context: { eventBus: EventBus<CoreEventMap> }
    stateRepository?: LifeStateRepository<HomeostasisState>
    homeostasisService?: HomeostasisService
    lifeRegistry?: { getAll(): LifeInstance[] }
  },
  HomeostasisService
>({
  name: 'elysia-ai-homeostasis',
  serviceFormalName: 'elysia.homeostasis',
  // kernel 兼容治理：声明身份/服务/阶段，runtime.start() 统一校验。
  manifest: {
    name: 'elysia-ai-homeostasis',
    version: '0.2.0',
    services: { provides: ['elysia.homeostasis'], consumes: ['elysia.runtime'] },
    configNamespace: 'homeostasis',
  },
  build({ runtime, config, logger }) {
    if (!runtime.stateRepository || !runtime.homeostasisService || !runtime.lifeRegistry) {
      logger.error('runtime homeostasis dependencies not found; homeostasis plugin cannot continue', undefined, {
        plugin: 'elysia-ai-homeostasis',
        phase: 'apply',
      })
      return undefined
    }
    const { dynamics, ...baseConfig } = config
    return createHomeostasisPluginRuntime({
      runtime: {
        context: runtime.context,
        stateRepository: runtime.stateRepository,
        homeostasisService: runtime.homeostasisService,
        lifeRegistry: runtime.lifeRegistry,
      },
      config: { ...baseConfig, ...dynamics } as HomeostasisConfig,
      logger,
    })
  },
})
