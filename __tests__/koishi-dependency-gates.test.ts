import { describe, expect, it, vi } from 'vitest'
import { apply as applyBody } from '../packages/elysia-ai-body/src/index.js'
import { apply as applyBrain } from '../packages/elysia-ai-brain/src/index.js'
import { apply as applyDialogue } from '../packages/elysia-ai-dialogue/src/index.js'
import { apply as applyModelGateway } from '../packages/elysia-ai-model-gateway/src/index.js'

function createFakeContext() {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }
  const ctx = {
    logger: vi.fn(() => logger),
    command: vi.fn(() => ({ action: vi.fn() })),
    on: vi.fn(),
  }
  return { ctx: ctx as any, logger }
}

describe('Elysia Koishi dependency gates', () => {
  it('model-gateway does not register without runtime', () => {
    const { ctx } = createFakeContext()

    applyModelGateway(ctx, { slots: {} } as any)

    expect(ctx['elysia.modelGateway']).toBeUndefined()
    expect(ctx['elysia-ai-model-gateway']).toBeUndefined()
  })

  it('brain does not register without model gateway', () => {
    const { ctx } = createFakeContext()
    ctx['elysia.runtime'] = { context: { eventBus: {} } }

    applyBrain(ctx, {} as any)

    expect(ctx['elysia.brain']).toBeUndefined()
    expect(ctx['elysia-ai-brain']).toBeUndefined()
  })

  it('dialogue does not register without brain', () => {
    const { ctx } = createFakeContext()
    ctx['elysia.runtime'] = { context: { eventBus: {} } }

    applyDialogue(ctx, { enabled: true, memoryLimit: 10 })

    expect(ctx['elysia.dialogue']).toBeUndefined()
    expect(ctx['elysia-ai-dialogue']).toBeUndefined()
  })

  it('body does not register without runtime', () => {
    const { ctx } = createFakeContext()

    applyBody(ctx, {})

    expect(ctx['elysia.body']).toBeUndefined()
    expect(ctx['elysia-ai-body']).toBeUndefined()
  })
})
