import { describe, it, expect, vi } from 'vitest'
import { MemoryEventBus } from '@elysia-ai/core'
import type { CoreEventMap } from '@elysia-ai/core'
import { MinimalLifecycle } from '../lifecycle/minimal-lifecycle'

function createEventBus() {
  return new MemoryEventBus<CoreEventMap>()
}

describe('MinimalLifecycle', () => {
  it('should start with idle state', () => {
    const lifecycle = new MinimalLifecycle(createEventBus())
    expect(lifecycle.getState()).toBe('idle')
    expect(lifecycle.isRunning()).toBe(false)
  })

  it('should transition to running after start()', async () => {
    const lifecycle = new MinimalLifecycle(createEventBus())
    await lifecycle.start()

    expect(lifecycle.getState()).toBe('running')
    expect(lifecycle.isRunning()).toBe(true)
  })

  it('should transition to stopped after stop()', async () => {
    const lifecycle = new MinimalLifecycle(createEventBus())
    await lifecycle.start()
    await lifecycle.stop()

    expect(lifecycle.getState()).toBe('stopped')
    expect(lifecycle.isRunning()).toBe(false)
  })

  it('should emit runtime.starting and runtime.started events on start()', async () => {
    const bus = createEventBus()
    const onStarting = vi.fn()
    const onStarted = vi.fn()

    bus.on('runtime.starting', onStarting)
    bus.on('runtime.started', onStarted)

    const lifecycle = new MinimalLifecycle(bus)
    await lifecycle.start()

    expect(onStarting).toHaveBeenCalledOnce()
    expect(onStarted).toHaveBeenCalledOnce()
    expect(onStarting.mock.calls[0][0].timestamp).toBeGreaterThan(0)
    expect(onStarted.mock.calls[0][0].timestamp).toBeGreaterThan(0)
  })

  it('should emit runtime.stopping and runtime.stopped events on stop()', async () => {
    const bus = createEventBus()
    const onStopping = vi.fn()
    const onStopped = vi.fn()

    bus.on('runtime.stopping', onStopping)
    bus.on('runtime.stopped', onStopped)

    const lifecycle = new MinimalLifecycle(bus)
    await lifecycle.start()
    await lifecycle.stop()

    expect(onStopping).toHaveBeenCalledOnce()
    expect(onStopped).toHaveBeenCalledOnce()
  })

  it('should throw if start() called when not idle', async () => {
    const lifecycle = new MinimalLifecycle(createEventBus())
    await lifecycle.start()

    await expect(lifecycle.start()).rejects.toThrow()
  })

  it('should throw if stop() called when not running', async () => {
    const lifecycle = new MinimalLifecycle(createEventBus())

    await expect(lifecycle.stop()).rejects.toThrow()
  })
})
