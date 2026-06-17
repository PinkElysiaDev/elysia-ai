/**
 * D3 生命状态层深化测试
 *
 * D3-1 内稳态恢复动力学：
 *   - 高于基线 → 向下衰减
 *   - 低于基线 → 向上恢复（idle 恢复，速率 = decay * recoveryFactor）
 *   - 正向情感交互回升
 *   - 仅对被路由的生命 tick，无路由记录则跳过
 * D3-2 core schema：memory/behavior/homeostasis/dialogue/persona 的 Zod schema 校验。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRuntime, type Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { HomeostasisState } from '../packages/@elysia-ai/core/src/index.js'
import {
  homeostasisStateSchema,
  memoryEntrySchema,
  behaviorCandidateSchema,
  dialogueTaskSchema,
  personaSchema,
} from '../packages/@elysia-ai/core/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'

function createCtx(runtime: Runtime) {
  const disposeHandlers: Array<() => void> = []
  const ctx: any = {
    'elysia-ai-runtime': runtime,
    logger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    on(event: string, handler: (...args: any[]) => any) {
      if (event === 'dispose') disposeHandlers.push(handler)
      return () => {}
    },
    dispose() { for (const h of disposeHandlers) h() },
  }
  return ctx
}

function installHomeostasis(ctx: any, overrides: Record<string, number> = {}) {
  homeostasisPlugin.apply(ctx, {
    initialEnergy: 0.8,
    initialMood: 0.6,
    initialSociability: 0.5,
    initialCuriosity: 0.7,
    energyDecayPerTick: 0.1,
    moodDecayPerTick: 0.1,
    sociabilityDecayPerTick: 0.1,
    curiosityDecayPerTick: 0.1,
    maxValue: 1,
    minValue: 0,
    responseThresholdMin: 0.3,
    responseThresholdMax: 0.8,
    restoreOnStartup: true,
    recoveryFactor: 0.5,
    ...overrides,
  } as any)
}

async function route(runtime: Runtime, stimulusId: string, lifeIds: string[]) {
  await runtime.context.eventBus.emit('projection.routed', {
    stimulusId,
    routing: { stimulusId, habitatId: 'h', lifeIds, projectionIds: [], routedAt: Date.now(), reason: 'test' },
  })
}

async function setState(runtime: Runtime, lifeId: string, patch: Partial<HomeostasisState>) {
  const cur = await runtime.stateRepository.getByLifeInstanceId(lifeId)
  await runtime.stateRepository.save(lifeId, { ...(cur as HomeostasisState), ...patch })
}

describe('D3-1 内稳态恢复动力学', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createCtx>
  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('高于基线时向下衰减', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'L1', type: 'elysia-default' }] })
    // energy 基线 0.8，抬到 0.95 → 应向下衰减 0.1 → 0.85
    await setState(runtime, 'L1', { energy: 0.95 })

    await route(runtime, 's1', ['L1'])

    const after = await runtime.stateRepository.getByLifeInstanceId('L1')
    expect(after?.energy).toBeCloseTo(0.85)
  })

  it('低于基线时向上恢复（idle 恢复，速率 = decay*recoveryFactor）', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'L1', type: 'elysia-default' }] })
    // energy 基线 0.8，压到 0.3 → 向上恢复 0.1*0.5=0.05 → 0.35
    await setState(runtime, 'L1', { energy: 0.3 })

    await route(runtime, 's1', ['L1'])

    const after = await runtime.stateRepository.getByLifeInstanceId('L1')
    expect(after?.energy).toBeCloseTo(0.35)
  })

  it('恢复不会越过基线', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'L1', type: 'elysia-default' }] })
    // energy 0.78，恢复步长 0.05 会冲到 0.83 越过基线 0.8 → 应钳到 0.8
    await setState(runtime, 'L1', { energy: 0.78 })

    await route(runtime, 's1', ['L1'])

    const after = await runtime.stateRepository.getByLifeInstanceId('L1')
    expect(after?.energy).toBeCloseTo(0.8)
  })

  it('在基线处不漂移（homeostasis 平衡态）', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'L1', type: 'elysia-default' }] })
    // 初始即基线 0.8，tick 后应仍为 0.8
    await route(runtime, 's1', ['L1'])

    const after = await runtime.stateRepository.getByLifeInstanceId('L1')
    expect(after?.energy).toBeCloseTo(0.8)
  })

  it('仅 tick 被路由的生命：未路由的生命不变', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'L1', type: 'elysia-default' }, { id: 'L2', type: 'elysia-default' }],
    })
    await setState(runtime, 'L1', { energy: 0.3 })
    await setState(runtime, 'L2', { energy: 0.3 })

    // 只路由 L1
    await route(runtime, 's1', ['L1'])

    const a1 = await runtime.stateRepository.getByLifeInstanceId('L1')
    const a2 = await runtime.stateRepository.getByLifeInstanceId('L2')
    expect(a1?.energy).toBeCloseTo(0.35) // 被路由，恢复
    expect(a2?.energy).toBeCloseTo(0.3)  // 未路由，不变
  })

  it('空 lifeIds 的 projection.routed 不 tick 任何生命', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createCtx(runtime)
    installHomeostasis(ctx)
    await runtime.loadManifest({ version: '1.0', lifeInstances: [{ id: 'L1', type: 'elysia-default' }] })
    await setState(runtime, 'L1', { energy: 0.3 })

    await route(runtime, 'orphan', [])

    const after = await runtime.stateRepository.getByLifeInstanceId('L1')
    expect(after?.energy).toBeCloseTo(0.3) // 未 tick
  })
})

describe('D3-2 core Zod schema', () => {
  it('homeostasisStateSchema 校验合法/拒绝非法', () => {
    expect(homeostasisStateSchema.safeParse({
      lifeInstanceId: 'L1', timestamp: 1, energy: 0.5, mood: 0.5, sociability: 0.5, curiosity: 0.5, responseThreshold: 0.4,
    }).success).toBe(true)
    expect(homeostasisStateSchema.safeParse({ lifeInstanceId: 'L1' }).success).toBe(false)
  })

  it('memoryEntrySchema 校验合法/拒绝非法', () => {
    expect(memoryEntrySchema.safeParse({
      id: 'm1', lifeId: 'L1', scope: 'life', kind: 'episodic', status: 'active',
      content: 'hi', importance: 0.5, confidence: 0.8, createdAt: 1, updatedAt: 1,
    }).success).toBe(true)
    expect(memoryEntrySchema.safeParse({ id: 'm1', kind: 'not-a-kind' }).success).toBe(false)
  })

  it('behaviorCandidateSchema 校验合法', () => {
    expect(behaviorCandidateSchema.safeParse({
      id: 'b1', type: 'reply', scope: { type: 'user', key: 'u1' }, sourceStimulusIds: ['s1'],
      priority: 50, confidence: 0.7, reason: 'r', shouldEnterDialogue: true, shouldUpdateMemory: false,
      shouldUpdateBond: false, shouldUpdateHomeostasis: false, shouldScheduleFollowup: false,
    }).success).toBe(true)
  })

  it('dialogueTaskSchema 校验合法', () => {
    expect(dialogueTaskSchema.safeParse({
      scope: { type: 'thread', key: 't1' }, sourceStimulusIds: ['s1'], mode: 'reply-now',
      messages: [{ role: 'user', content: 'hi' }],
    }).success).toBe(true)
  })

  it('personaSchema 校验合法/拒绝非法', () => {
    expect(personaSchema.safeParse({ lifeId: 'L1', name: 'Elysia', systemPrompt: 'be kind' }).success).toBe(true)
    expect(personaSchema.safeParse({ name: 'Elysia' }).success).toBe(false)
  })
})
