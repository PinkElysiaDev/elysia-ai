/**
 * Phase 12 Behavior Candidate 集成测试
 *
 * 验证 behavior planner 从单一路由决策升级为：
 * 1. 生成 BehaviorCandidate 列表
 * 2. 选择 BehaviorDecision
 * 3. 保持 behavior.selected / behavior.instruction 兼容
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRuntime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type { Runtime } from '../packages/elysia-ai-runtime/src/runtime.js'
import type {
  CoreEventMap,
  Stimulus,
} from '../packages/@elysia-ai/core/src/index.js'
import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import {
  generateBehaviorCandidates,
  selectBehaviorCandidate,
} from '../packages/@elysia-ai/behavior/src/candidates.js'
import type { StimulusScope, StimulusSignal } from '../packages/@elysia-ai/behavior/src/types.js'

function createMockKoishiContext(runtime: Runtime) {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {}
  const disposeHandlers: Array<() => void> = []

  const ctx: any = {
    'elysia-ai-runtime': runtime,

    logger() {
      return {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }
    },

    on(event: string, handler: (...args: any[]) => any) {
      ;(handlers[event] ??= []).push(handler)
      if (event === 'dispose') disposeHandlers.push(handler)
      return () => {
        const list = handlers[event]
        if (!list) return
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },

    dispose() {
      for (const handler of disposeHandlers) handler()
    },
  }

  return ctx
}

function installBehaviorPipeline(ctx: any) {
  behaviorPlugin.apply(ctx, {
    enableReply: true,
    directWindowMs: 1500,
    userBufferedWindowMs: 2500,
    threadBufferedWindowMs: 3500,
    habitatBufferedWindowMs: 5000,
  })
}

function createStimulus(id: string): Stimulus {
  return {
    id,
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-phase12-candidates',
    actorId: 'user-phase12-candidates',
    channelId: 'channel-phase12-candidates',
    payload: {
      content: '你好，我想问一个问题',
    },
  }
}

describe('Phase 12 Behavior Candidate 集成测试', () => {
  let runtime: Runtime
  let ctx: ReturnType<typeof createMockKoishiContext>

  afterEach(async () => {
    ctx?.dispose()
    if (runtime?.getState() === 'running') await runtime.stop()
  })

  it('behavior planning 会生成 candidates 并在 selected 事件中携带 decision', async () => {
    runtime = createDefaultRuntime()
    await runtime.start()
    ctx = createMockKoishiContext(runtime)
    installBehaviorPipeline(ctx)

    const candidateEvents: CoreEventMap['behavior.candidates.generated'][] = []
    const selectedEvents: CoreEventMap['behavior.selected'][] = []
    const instructionEvents: CoreEventMap['behavior.instruction'][] = []

    runtime.context.eventBus.on('behavior.candidates.generated', (payload) => {
      candidateEvents.push(payload)
    })
    runtime.context.eventBus.on('behavior.selected', (payload) => {
      selectedEvents.push(payload)
    })
    runtime.context.eventBus.on('behavior.instruction', (payload) => {
      instructionEvents.push(payload)
    })

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{
        id: 'life-phase12-candidate',
        type: 'elysia-default',
      }],
    })

    await runtime.receiveStimulus(createStimulus('p12-behavior-candidate-1'))

    expect(candidateEvents).toHaveLength(1)
    expect(candidateEvents[0].stimulusId).toBe('p12-behavior-candidate-1')
    expect(candidateEvents[0].candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidateEvents[0].candidates[0].type).toBe('reply')

    expect(selectedEvents).toHaveLength(1)
    expect(selectedEvents[0].lifeId).toBe('life-phase12-candidate')
    expect(selectedEvents[0].candidates).toHaveLength(candidateEvents[0].candidates.length)
    expect(selectedEvents[0].behaviorDecision?.selected.id).toBe(candidateEvents[0].candidates[0].id)
    expect(selectedEvents[0].plan.mode).toBe(selectedEvents[0].decision)

    expect(instructionEvents).toHaveLength(1)
    expect(instructionEvents[0].instruction.lifeId).toBe('life-phase12-candidate')
    expect(instructionEvents[0].instruction.plan.mode).toBe(selectedEvents[0].plan.mode)
  })

  it('candidate selection 会按 priority 选择最高优先级候选', () => {
    const scope: StimulusScope = {
      type: 'thread',
      key: 'habitat-phase12-candidates:thread-main',
    }
    const signal: StimulusSignal = {
      directness: 70,
      continuity: 100,
      bondAffinity: 0,
      bufferPressure: 70,
      responseNecessity: 65,
      structuralDeterminability: 35,
    }

    const candidates = generateBehaviorCandidates(
      scope,
      'p12-behavior-candidate-buffer',
      'send-to-ai',
      signal,
    )
    const decision = selectBehaviorCandidate(
      'p12-behavior-candidate-buffer',
      candidates,
      signal,
    )

    expect(candidates.length).toBeGreaterThanOrEqual(2)
    expect(decision.selected.priority).toBe(candidates[0].priority)
    expect(decision.metadata?.candidateCount).toBe(candidates.length)
  })
})
