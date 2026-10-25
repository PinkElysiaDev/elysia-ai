import { describe, expect, it } from 'vitest'
import type { Stimulus } from '@elysia-ai/core'
import { createDefaultRuntime } from '../runtime.js'

/**
 * 优先级串行队列（vtuber 插队语义）：
 * - 同 habitat 串行不变（读-改-写保护，P1-9）；
 * - 即时唤醒（priority 0）插到等待中的批量唤醒（priority 1）前；
 * - 正在执行的任务不可抢占；跨 habitat 并行。
 */
function stimulus(id: string, habitatId: string): Stimulus {
  return {
    id,
    type: 'addressing',
    timestamp: Date.now(),
    habitatId,
    payload: {},
    metadata: {},
  }
}

async function makeRuntime(order: string[], listener?: (id: string) => void) {
  const logger = { info() {}, debug() {}, warn() {}, error() {} }
  const runtime = createDefaultRuntime(logger)
  // 直接监听事件记录处理顺序（processStimulus 第一步 emit）
  runtime.context.eventBus.on('stimulus.received', ({ stimulusId }) => {
    order.push(stimulusId)
    listener?.(stimulusId)
  })
  await runtime.loadManifest({
    version: '1.0',
    lifeInstances: [{ id: 'life-r', type: 'elysia-default' }],
  })
  await runtime.start()
  return runtime
}

describe('receiveStimulus 优先级插队', () => {
  it('priority 0 插到等待中的 priority 1 之前（同级保持 FIFO）', async () => {
    const order: string[] = []
    const runtime = await makeRuntime(order)

    const p1 = runtime.receiveStimulus(stimulus('batch-1', 'g1'))
    const p2 = runtime.receiveStimulus(stimulus('batch-2', 'g1'))
    const p0 = runtime.receiveStimulus(stimulus('instant-1', 'g1'), { priority: 0 })
    await Promise.all([p1, p2, p0])

    // instant-1 可能赶不上正在执行的 batch-1（不可抢占），但必须在 batch-2 前
    expect(order.indexOf('instant-1')).toBeLessThan(order.indexOf('batch-2'))
    expect(order).toHaveLength(3)
  })

  it('默认 priority=1：三个同优先级严格 FIFO', async () => {
    const order: string[] = []
    const runtime = await makeRuntime(order)

    await Promise.all([
      runtime.receiveStimulus(stimulus('a', 'g1')),
      runtime.receiveStimulus(stimulus('b', 'g1')),
      runtime.receiveStimulus(stimulus('c', 'g1')),
    ])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('跨 habitat 并行：不同群互不排队', async () => {
    const order: string[] = []
    const runtime = await makeRuntime(order)

    await Promise.all([
      runtime.receiveStimulus(stimulus('g1-msg', 'g1')),
      runtime.receiveStimulus(stimulus('g2-msg', 'g2')),
    ])
    expect(order.sort()).toEqual(['g1-msg', 'g2-msg'])
  })

  it('处理失败不毒化队列（后续条目继续执行）', async () => {
    const order: string[] = []
    const logger = { info() {}, debug() {}, warn() {}, error() {} }
    const runtime = await makeRuntime(order, (id) => {
      if (id === 'bad') throw new Error('listener boom')
    })

    await Promise.all([
      runtime.receiveStimulus(stimulus('bad', 'g1')),
      runtime.receiveStimulus(stimulus('good', 'g1')),
    ])
    expect(order).toContain('good')
  })
})
