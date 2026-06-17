import { describe, expect, it, vi } from 'vitest'
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
  return ctx as typeof ctx & Record<string, unknown>
}

describe('Elysia Koishi service registry helper', () => {
  it('registers formal and legacy aliases and clears them on dispose', () => {
    const ctx = createFakeContext()
    const service = { id: 'runtime' }

    const dispose = registerElysiaService(ctx as any, {
      formalName: 'elysia.runtime',
      legacyName: 'elysia-ai-runtime',
      service,
    })

    expect(ctx['elysia.runtime']).toBe(service)
    expect(ctx['elysia-ai-runtime']).toBe(service)
    expect(getOptionalElysiaService(ctx as any, { formalName: 'elysia.runtime' })).toBe(service)

    dispose()

    expect(ctx['elysia.runtime']).toBeUndefined()
    expect(ctx['elysia-ai-runtime']).toBeUndefined()
  })

  it('keeps newer services when disposing an older registration', () => {
    const ctx = createFakeContext()
    const first = { id: 'first' }
    const second = { id: 'second' }

    const disposeFirst = registerElysiaService(ctx as any, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
      service: first,
    })
    registerElysiaService(ctx as any, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
      service: second,
    })

    disposeFirst()

    expect(ctx['elysia.brain']).toBe(second)
    expect(ctx['elysia-ai-brain']).toBe(second)
  })

  it('prefers formal aliases and falls back to legacy aliases', () => {
    const ctx = createFakeContext()
    const legacyService = { id: 'legacy' }
    const formalService = { id: 'formal' }

    ctx['elysia-ai-model-gateway'] = legacyService
    expect(
      getOptionalElysiaService(ctx as any, {
        formalName: 'elysia.modelGateway',
        legacyName: 'elysia-ai-model-gateway',
      }),
    ).toBe(legacyService)

    ctx['elysia.modelGateway'] = formalService
    expect(
      getOptionalElysiaService(ctx as any, {
        formalName: 'elysia.modelGateway',
        legacyName: 'elysia-ai-model-gateway',
      }),
    ).toBe(formalService)
  })

  it('logs a dependency gate error for missing required services', () => {
    const ctx = createFakeContext()
    const logger = { error: vi.fn() }

    const service = getRequiredElysiaService(ctx as any, {
      formalName: 'elysia.brain',
      legacyName: 'elysia-ai-brain',
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
        legacyName: 'elysia-ai-brain',
      }),
    )
  })
})
