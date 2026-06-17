/**
 * R1 回归：事件总线 listener 隔离（M1）+ 感知 listener 异常不逃逸（M2）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md，M1/M2）：
 * 旧 MemoryEventBus.emit 在首个 listener 抛错时中止后续 listener 并向发布方重抛，
 * 导致一个观测/感知 listener 失败会让无关订阅者静默丢事件、发布方收到异常。
 */

import { describe, it, expect, vi } from 'vitest'
import { MemoryEventBus } from '../packages/@elysia-ai/core/src/bus/memory-event-bus.js'

interface TestMap {
  'test.event': { value: number }
}

describe('R1 MemoryEventBus listener 隔离', () => {
  it('单个 listener 抛错不应中断其余 listener', async () => {
    const bus = new MemoryEventBus<TestMap>()
    const before = vi.fn()
    const after = vi.fn()

    bus.on('test.event', () => { before() })
    bus.on('test.event', () => { throw new Error('listener boom') })
    bus.on('test.event', () => { after() })

    await bus.emit('test.event', { value: 1 })

    expect(before).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('listener 抛错不应向 emit 调用方冒泡', async () => {
    const bus = new MemoryEventBus<TestMap>()
    bus.on('test.event', () => { throw new Error('listener boom') })

    await expect(bus.emit('test.event', { value: 1 })).resolves.toBeUndefined()
  })

  it('async listener 拒绝不应向 emit 调用方冒泡', async () => {
    const bus = new MemoryEventBus<TestMap>()
    bus.on('test.event', async () => { throw new Error('async boom') })
    const after = vi.fn()
    bus.on('test.event', () => { after() })

    await expect(bus.emit('test.event', { value: 1 })).resolves.toBeUndefined()
    expect(after).toHaveBeenCalledTimes(1)
  })
})
