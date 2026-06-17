import { Schema } from 'koishi'
import { createHomeostasisPluginRuntime } from '@elysia-ai/homeostasis'
import type { Config as HomeostasisConfig } from '@elysia-ai/homeostasis'
import type { CoreEventMap, EventBus, HomeostasisService, HomeostasisState, LifeInstance, LifeStateRepository } from '@elysia-ai/core'
import { createElysiaPlugin } from '@elysia-ai/shared'
export * from '@elysia-ai/homeostasis'

export const name = 'elysia-ai-homeostasis'

export const Config: Schema<HomeostasisConfig> = Schema.intersect([
  Schema.object({
    restoreOnStartup: Schema.boolean().default(true)
      .description('恢复上次持久化的稳态状态（runtime 重启后重新加载）。'),
  }).description('基础设置'),
  Schema.object({
    initialEnergy: Schema.number().default(0.8).description('初始能量（0~1）。'),
    initialMood: Schema.number().default(0.6).description('初始心情（0~1）。'),
    initialSociability: Schema.number().default(0.5).description('初始社交倾向（0~1）。'),
    initialCuriosity: Schema.number().default(0.7).description('初始好奇心（0~1）。'),
  }).description('高级：初始状态'),
  Schema.object({
    energyDecayPerTick: Schema.number().default(0.01).description('每次状态更新时能量的衰减幅度。'),
    moodDecayPerTick: Schema.number().default(0.005).description('每次状态更新时心情的衰减幅度。'),
    sociabilityDecayPerTick: Schema.number().default(0.003).description('每次状态更新时社交倾向的衰减幅度。'),
    curiosityDecayPerTick: Schema.number().default(0.002).description('每次状态更新时好奇心的衰减幅度。'),
  }).description('高级：衰减速率'),
  Schema.object({
    energyBaseline: Schema.number().description('能量静息基线，留空则取初始能量。指标朝基线松弛而非衰减到 0。'),
    moodBaseline: Schema.number().description('心情静息基线，留空则取初始心情。'),
    sociabilityBaseline: Schema.number().description('社交倾向静息基线，留空则取初始社交倾向。'),
    curiosityBaseline: Schema.number().description('好奇心静息基线，留空则取初始好奇心。'),
    recoveryFactor: Schema.number().default(0.5)
      .description('低于基线时的恢复速率相对衰减速率的倍率（空闲恢复通常更慢）。'),
  }).description('高级：恢复动力学'),
  Schema.object({
    maxValue: Schema.number().default(1.0).description('各状态指标的上限。'),
    minValue: Schema.number().default(0.0).description('各状态指标的下限。'),
    responseThresholdMin: Schema.number().default(0.3).description('回应阈值下限。'),
    responseThresholdMax: Schema.number().default(0.8).description('回应阈值上限。'),
  }).description('高级：取值边界'),
])

export const apply = createElysiaPlugin<
  HomeostasisConfig,
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
  serviceLegacyName: 'elysia-ai-homeostasis',
  build({ runtime, config, logger }) {
    if (!runtime.stateRepository || !runtime.homeostasisService || !runtime.lifeRegistry) {
      logger.error('runtime homeostasis dependencies not found; homeostasis plugin cannot continue', undefined, {
        plugin: 'elysia-ai-homeostasis',
        phase: 'apply',
      })
      return undefined
    }
    return createHomeostasisPluginRuntime({
      runtime: {
        context: runtime.context,
        stateRepository: runtime.stateRepository,
        homeostasisService: runtime.homeostasisService,
        lifeRegistry: runtime.lifeRegistry,
      },
      config,
      logger,
    })
  },
})


