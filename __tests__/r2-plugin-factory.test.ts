import { describe, expect, it, vi } from 'vitest'
import { createElysiaPlugin } from '../packages/@elysia-ai/shared/src/index.js'

// R2-4：createElysiaPlugin 工厂契约测试。
// 覆盖此前 apply() 缺失的成功注册路径与 dispose 清理路径，
// 以及两条放弃注册的门控（无 eventBus / build 返回 undefined）。

function createLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createFakeContext() {
  const logger = createLogger()
  const disposeHandlers: Array<() => void> = []
  const ctx = {
    logger: vi.fn(() => logger),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'dispose') disposeHandlers.push(handler)
    }),
  }
  return {
    ctx: ctx as any,
    logger,
    runDispose: () => disposeHandlers.forEach((h) => h()),
  }
}

const runtimeWithBus = { context: { eventBus: {} } }

describe('createElysiaPlugin factory', () => {
  it('registers the service under formal and legacy names on the success path', () => {
    const { ctx } = createFakeContext()
    ctx['elysia.runtime'] = runtimeWithBus
    const service = { id: 'svc' }

    const apply = createElysiaPlugin<Record<string, never>, typeof runtimeWithBus, typeof service>({
      name: 'elysia-ai-test',
      serviceFormalName: 'elysia.test',
      serviceLegacyName: 'elysia-ai-test',
      build: () => ({ service, dispose: vi.fn() }),
    })

    apply(ctx, {})

    expect(ctx['elysia.test']).toBe(service)
    expect(ctx['elysia-ai-test']).toBe(service)
  })

  it('does not register when runtime has no eventBus', () => {
    const { ctx } = createFakeContext()
    ctx['elysia.runtime'] = { context: {} }
    const build = vi.fn()

    const apply = createElysiaPlugin<Record<string, never>, any, unknown>({
      name: 'elysia-ai-test',
      serviceFormalName: 'elysia.test',
      build,
    })

    apply(ctx, {})

    expect(build).not.toHaveBeenCalled()
    expect(ctx['elysia.test']).toBeUndefined()
  })

  it('does not register when build returns undefined', () => {
    const { ctx } = createFakeContext()
    ctx['elysia.runtime'] = runtimeWithBus

    const apply = createElysiaPlugin<Record<string, never>, typeof runtimeWithBus, unknown>({
      name: 'elysia-ai-test',
      serviceFormalName: 'elysia.test',
      build: () => undefined,
    })

    apply(ctx, {})

    expect(ctx['elysia.test']).toBeUndefined()
  })

  it('disposes the runtime handle and clears the service on dispose', () => {
    const { ctx, runDispose } = createFakeContext()
    ctx['elysia.runtime'] = runtimeWithBus
    const dispose = vi.fn()
    const service = { id: 'svc' }

    const apply = createElysiaPlugin<Record<string, never>, typeof runtimeWithBus, typeof service>({
      name: 'elysia-ai-test',
      serviceFormalName: 'elysia.test',
      serviceLegacyName: 'elysia-ai-test',
      build: () => ({ service, dispose }),
    })

    apply(ctx, {})
    expect(ctx['elysia.test']).toBe(service)

    runDispose()

    expect(dispose).toHaveBeenCalledOnce()
    expect(ctx['elysia.test']).toBeUndefined()
    expect(ctx['elysia-ai-test']).toBeUndefined()
  })
})
