/**
 * Phase 45 Operational Surface
 *
 * ?????????????? observatory ???
 * 1. operational snapshot ?? gateway/repository/failure ????????/???
 * 2. preflight ???????????????
 * 3. observatory ?????? status/preflight ???
 */

import { describe, expect, it, vi } from 'vitest'
import { MemoryEventBus, type CoreEventMap } from '../packages/@elysia-ai/core/src/index.js'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/index.js'
import { apply, runElysiaPreflight } from '../packages/elysia-ai-observatory/src/index.js'
import { preflightModelGatewayConfig } from '../packages/elysia-ai-model-gateway/src/index.js'
import { preflightMemoryConfig } from '../packages/elysia-ai-memory/src/index.js'

type CommandAction = (...args: any[]) => unknown

interface RegisteredCommand {
  name: string
  description: string
  action?: CommandAction
}

function createCommandRecordingContext() {
  const commands = new Map<string, RegisteredCommand>()
  const eventBus = new MemoryEventBus<CoreEventMap>()
  const ctx: any = {
    'elysia.runtime': {
      context: { eventBus },
    },
    logger() {
      return {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }
    },
    command(name: string, description: string) {
      const command: RegisteredCommand = { name, description }
      commands.set(name, command)
      return {
        action(callback: CommandAction) {
          command.action = callback
          return this
        },
      }
    },
    on() {
      return () => {}
    },
  }

  return { ctx, commands, eventBus }
}

function runCommand(commands: Map<string, RegisteredCommand>, name: string, ...args: any[]): string {
  const command = commands.get(name)
  expect(command, `command ${name} should be registered`).toBeDefined()
  expect(command?.action, `command ${name} should have action`).toBeDefined()
  return String(command!.action!(...args))
}

describe('Phase 45 Operational Surface', () => {
  it('operational snapshot should aggregate analytics without leaking secrets or message bodies', () => {
    const service = new DefaultObservatoryService()

    service.recordEvent('gateway.failed', {
      request: {
        messages: [{ role: 'user', content: 'full user prompt must not appear in operational snapshot' }],
      },
      diagnostics: {
        finalErrorCode: 'http-503',
        route: {
          providerId: 'prod-openai',
          providerType: 'openai',
          model: 'gpt-production',
        },
      },
      apiKey: 'sk-secret-should-never-leak',
      error: { code: 'http-503', message: 'upstream failed' },
    })
    service.recordEvent('repository.initialized', {
      component: 'memory',
      repositoryType: 'mongo',
    })
    service.recordEvent('repository.query.failed', {
      component: 'bond',
      repositoryType: 'mongo',
      error: { code: 'mongo-timeout' },
    })

    const snapshot = service.getOperationalSnapshot()
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.gatewayAnalytics.failureCount).toBe(1)
    expect(snapshot.repositoryAnalytics.initializedCount).toBe(1)
    expect(snapshot.repositoryAnalytics.queryFailureCount).toBe(1)
    expect(snapshot.recentFailures[0]).toMatchObject({
      event: 'gateway.failed',
      providerId: 'prod-openai',
      providerType: 'openai',
      model: 'gpt-production',
      errorCode: 'http-503',
    })
    expect(serialized).not.toContain('sk-secret-should-never-leak')
    expect(serialized).not.toContain('full user prompt must not appear')
  })

  it('preflight helpers should return structured sanitized results', () => {
    const invalidGateway = preflightModelGatewayConfig({
      providers: {
        prod: {
          type: 'openai',
          model: 'gpt-production',
          apiKey: 'sk-live-secret',
        },
      },
      providerSlots: {
        reasoning: { provider: 'missing-provider' },
      },
    } as any)

    expect(invalidGateway.ok).toBe(false)
    expect(invalidGateway.errors[0]).toMatchObject({
      plugin: 'elysia-ai-model-gateway',
      code: 'gateway.invalid-config',
      severity: 'error',
    })
    expect(JSON.stringify(invalidGateway)).not.toContain('sk-live-secret')

    const localMemory = preflightMemoryConfig({} as any)
    expect(localMemory.ok).toBe(true)
    expect(localMemory.warnings.some((warning) => warning.code === 'memory.repository.memory-default')).toBe(true)

    const combined = runElysiaPreflight({
      modelGateway: { preflight: () => invalidGateway },
      memory: { preflight: () => localMemory },
    })
    expect(combined.ok).toBe(false)
    expect(combined.errors.length).toBe(1)
    expect(combined.warnings.length).toBeGreaterThanOrEqual(1)
  })

  it('observatory plugin should register operational commands with stable sanitized output', () => {
    const { ctx, commands } = createCommandRecordingContext()
    ctx['elysia.modelGateway'] = {
      getRegistry() {
        return {
          getAll() {
            return [{ getDescriptor: () => ({ id: 'prod', type: 'openai', model: 'gpt-production', apiKey: 'sk-hidden' }) }]
          },
        }
      },
      getHealthSnapshots() {
        return [{ providerId: 'prod', status: 'healthy' }]
      },
    }

    apply(ctx, { enabled: true, maxRecords: 100 })

    expect([...commands.keys()]).toEqual(expect.arrayContaining([
      'elysia.status',
      'elysia.gateway.status',
      'elysia.repository.status',
      'elysia.preflight',
    ]))

    ctx['elysia.observatory'].recordEvent('repository.initialized', {
      component: 'memory',
      repositoryType: 'mongo',
    })

    const status = runCommand(commands, 'elysia.status')
    expect(status).toContain('Elysia A.I. Status')
    expect(status).toContain('runtime: loaded')
    expect(status).toContain('observatory: loaded')

    const gatewayStatus = runCommand(commands, 'elysia.gateway.status')
    expect(gatewayStatus).toContain('Elysia Gateway Status')
    expect(gatewayStatus).toContain('prod: type=openai, model=gpt-production')
    expect(gatewayStatus).not.toContain('sk-hidden')

    const repositoryStatus = runCommand(commands, 'elysia.repository.status')
    expect(repositoryStatus).toContain('Elysia Repository Status')
    expect(repositoryStatus).toContain('initialized: 1')
    expect(repositoryStatus).toContain('"memory":1')

    const preflight = runCommand(commands, 'elysia.preflight', {}, {
      memory: { preflight: () => preflightMemoryConfig({} as any) },
    })
    expect(preflight).toContain('Elysia Preflight: ok')
    expect(preflight).toContain('memory.repository.memory-default')
  })

  it('operational commands should degrade gracefully when optional services are missing', () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, { enabled: true, maxRecords: 100 })

    delete ctx['elysia.modelGateway']
    delete ctx['elysia-ai-model-gateway']

    expect(runCommand(commands, 'elysia.gateway.status')).toBe('Model gateway service not loaded.')
    expect(runCommand(commands, 'elysia.repository.status')).toContain('Elysia Repository Status')
    expect(runCommand(commands, 'elysia.preflight')).toContain('preflight.no-config')
  })
})
