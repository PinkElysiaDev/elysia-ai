import { describe, expect, it, vi } from 'vitest'
import { asCordisContext } from 'koishi'
import {
  getOptionalElysiaService,
  getRequiredElysiaService,
  registerElysiaService,
} from '../packages/@elysia-ai/shared/src/service-registry.js'

function createFakeContext() {
  const listeners: Record<string, (() => void)[]> = {}
  const ctx = {
    on(event: string, listener: () => void) {
      listeners[event] ||= []
      listeners[event].push(listener)
      return () => {
        listeners[event] = listeners[event].filter((item) => item !== listener)
      }
    },
    emitDispose() {
      for (const listener of listeners.dispose ?? []) listener()
    },
  }
  return asCordisContext(ctx) as typeof ctx & Record<string, unknown>
}

describe('Elysia Koishi service registry helper', () => {
  it('registers the formal service name（销毁由 cordis effect 托管）', () => {
    const ctx = createFakeContext()
    const service = { id: 'runtime' }

    registerElysiaService(ctx as any, {
      formalName: 'elysia.runtime',
      service,
    })

    expect(ctx['elysia.runtime']).toBe(service)
    expect(getOptionalElysiaService(ctx as any, { formalName: 'elysia.runtime' })).toBe(service)
  })

  it('重复注册不抛错（非空覆盖记 debug 日志后跳过）', () => {
    const ctx = createFakeContext()
    const logger = { debug: vi.fn() }

    registerElysiaService(ctx as any, {
      formalName: 'elysia.brain',
      service: { id: 'first' },
    })
    expect(() => {
      registerElysiaService(ctx as any, {
        formalName: 'elysia.brain',
        service: { id: 'second' },
        logger,
      })
    }).not.toThrow()
  })

  it('getOptionalElysiaService 未注册的服务名返回 undefined', () => {
    const ctx = createFakeContext()

    expect(getOptionalElysiaService(ctx as any, { formalName: 'elysia.modelGateway' })).toBeUndefined()

    const service = { id: 'gateway' }
    ctx['elysia.modelGateway'] = service
    expect(getOptionalElysiaService(ctx as any, { formalName: 'elysia.modelGateway' })).toBe(service)
  })

  it('logs a dependency gate error for missing required services', () => {
    const ctx = createFakeContext()
    const logger = { error: vi.fn() }

    const service = getRequiredElysiaService(ctx as any, {
      formalName: 'elysia.brain',
      logger,
      plugin: 'elysia-ai-dialogue',
      description: 'brain service',
    })

    expect(service).toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'brain service not found; plugin cannot continue',
      undefined,
      expect.objectContaining({
        plugin: 'elysia-ai-dialogue',
        formalName: 'elysia.brain',
      }),
    )
  })
})
