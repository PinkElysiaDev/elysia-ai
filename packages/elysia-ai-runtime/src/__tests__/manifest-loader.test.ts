import { describe, it, expect, vi } from 'vitest'
import { parseManifest, validateManifest } from '../manifest/loader'
import { createDefaultRuntime } from '../runtime'

// ==================== parseManifest 测试 ====================

describe('parseManifest()', () => {
  it('should parse a valid manifest JSON', () => {
    const json = JSON.stringify({
      version: '1.0',
      lifeInstances: [
        {
          id: 'elysia-main',
          type: 'elysia-default',
        },
      ],
    })

    const config = parseManifest(json)

    expect(config.version).toBe('1.0')
    expect(config.lifeInstances).toHaveLength(1)
    expect(config.lifeInstances[0].id).toBe('elysia-main')
    expect(config.lifeInstances[0].type).toBe('elysia-default')
  })

  it('should default enabled to true when not specified', () => {
    const json = JSON.stringify({
      version: '1.0',
      lifeInstances: [{ id: 'test', type: 'test-type' }],
    })

    const config = parseManifest(json)
    expect(config.lifeInstances[0].enabled).toBe(true)
  })

  it('should preserve extensions field', () => {
    const json = JSON.stringify({
      version: '1.0',
      lifeInstances: [
        {
          id: 'test',
          type: 'test-type',
          extensions: {
            '@elysia-ai/persona': { traits: ['friendly'] },
          },
        },
      ],
    })

    const config = parseManifest(json)
    expect(config.lifeInstances[0].extensions?.['@elysia-ai/persona']).toEqual({
      traits: ['friendly'],
    })
  })

  it('should throw on invalid JSON', () => {
    expect(() => parseManifest('not-valid-json')).toThrow('Manifest JSON parse error')
  })

  it('should throw if version is missing', () => {
    const json = JSON.stringify({ lifeInstances: [] })
    expect(() => parseManifest(json)).toThrow('version')
  })

  it('should throw if lifeInstances is missing', () => {
    const json = JSON.stringify({ version: '1.0' })
    expect(() => parseManifest(json)).toThrow('lifeInstances')
  })

  it('should throw if a life instance is missing id', () => {
    const json = JSON.stringify({
      version: '1.0',
      lifeInstances: [{ type: 'test-type' }],
    })
    expect(() => parseManifest(json)).toThrow('id')
  })

  it('should throw if a life instance is missing type', () => {
    const json = JSON.stringify({
      version: '1.0',
      lifeInstances: [{ id: 'test' }],
    })
    expect(() => parseManifest(json)).toThrow('type')
  })
})

// ==================== Runtime.loadManifest 测试 ====================

describe('Runtime.loadManifest()', () => {
  it('should register enabled life instances', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-1', type: 'elysia-default', enabled: true },
        { id: 'life-2', type: 'elysia-default' }, // 默认 enabled
      ],
    })

    expect(runtime.lifeRegistry.getById('life-1')).toBeDefined()
    expect(runtime.lifeRegistry.getById('life-2')).toBeDefined()
    expect(runtime.lifeRegistry.getAll()).toHaveLength(2)
  })

  it('should skip disabled life instances', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'active', type: 'elysia-default', enabled: true },
        { id: 'disabled', type: 'elysia-default', enabled: false },
      ],
    })

    expect(runtime.lifeRegistry.getById('active')).toBeDefined()
    expect(runtime.lifeRegistry.getById('disabled')).toBeUndefined()
    expect(runtime.lifeRegistry.getAll()).toHaveLength(1)
  })

  it('should emit life.loaded event for each registered instance', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    const handler = vi.fn()
    runtime.context.eventBus.on('life.loaded', handler)

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [
        { id: 'life-1', type: 'elysia-default' },
        { id: 'life-2', type: 'elysia-default' },
        { id: 'life-disabled', type: 'elysia-default', enabled: false },
      ],
    })

    // 只有 enabled 的实例会发事件
    expect(handler).toHaveBeenCalledTimes(2)

    const calls = handler.mock.calls.map(c => c[0].lifeId)
    expect(calls).toContain('life-1')
    expect(calls).toContain('life-2')
    expect(calls).not.toContain('life-disabled')
  })

  it('should store type in life instance metadata', async () => {
    const runtime = createDefaultRuntime()
    await runtime.start()

    await runtime.loadManifest({
      version: '1.0',
      lifeInstances: [{ id: 'life-1', type: 'custom-type' }],
    })

    const life = runtime.lifeRegistry.getById('life-1')
    expect(life?.metadata?.['type']).toBe('custom-type')
  })
})
