/**
 * Phase 34 Gateway Debug Commands
 *
 * 验证 model-gateway 提供运行时调试命令：
 * 1. 注册 slots / registry / health / failures 命令
 * 2. slots 命令输出 slot -> provider 映射且不泄露 apiKey
 * 3. registry 命令输出 provider descriptor
 * 4. health 命令输出 provider health snapshot
 * 5. failures 命令在 observatory 不存在时给出友好提示
 * 6. failures 命令在 observatory 存在时输出最近 gateway.failed trace
 */

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../packages/elysia-ai-model-gateway/src/index.js'
import type { Config } from '../packages/@elysia-ai/model-gateway/src/index.js'

type CommandAction = (...args: any[]) => unknown

interface RegisteredCommand {
  name: string
  description: string
  action?: CommandAction
}

function createCommandRecordingContext(observatory?: any) {
  const commands = new Map<string, RegisteredCommand>()
  const eventBus = {
    emit: vi.fn(async () => undefined),
  }

  const ctx: any = {
    'elysia-ai-runtime': {
      context: {
        eventBus,
      },
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

  if (observatory) {
    ctx['elysia-ai-observatory'] = observatory
  }

  return { ctx, commands, eventBus }
}

function createGatewayConfig(): Config {
  return {
    slots: {
      reasoning: {
        type: 'gemini',
        apiKey: 'gemini-secret-key',
        endpoint: 'https://gemini.example/v1beta',
        model: 'gemini-1.5-pro',
      },
      fast: {
        type: 'openai-compatible',
        apiKey: 'fast-secret-key',
        endpoint: 'https://compatible.example/v1',
        model: 'fast-model',
      },
    },
    defaultSlot: 'reasoning',
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 30000 },
    fallback: {
      enabled: true,
      slots: {
        reasoning: ['fast'],
      },
    },
  }
}

function runCommand(commands: Map<string, RegisteredCommand>, name: string, ...args: any[]): string {
  const command = commands.get(name)
  expect(command, `command ${name} should be registered`).toBeDefined()
  expect(command?.action, `command ${name} should have action`).toBeDefined()
  return String(command!.action!(...args))
}

describe('Phase 34 Gateway Debug Commands', () => {
  it('apply should register gateway debug commands', () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, createGatewayConfig())

    expect([...commands.keys()]).toEqual(expect.arrayContaining([
      'elysia.gateway.slots',
      'elysia.gateway.registry',
      'elysia.gateway.health [providerId:string]',
      'elysia.gateway.failures [limit:number]',
    ]))
  })

  it('slots command should render slot mapping without leaking api keys', () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, createGatewayConfig())

    const output = runCommand(commands, 'elysia.gateway.slots')

    expect(output).toContain('Model Gateway Slots')
    expect(output).toContain('defaultSlot: reasoning')
    expect(output).toContain('reasoning -> slot:reasoning')
    expect(output).toContain('type: gemini')
    expect(output).toContain('model: gemini-1.5-pro')
    expect(output).toContain('fast -> slot:fast')
    expect(output).toContain('type: openai-compatible')
    expect(output).toContain('model: fast-model')
    expect(output).not.toContain('gemini-secret-key')
    expect(output).not.toContain('fast-secret-key')
  })

  it('registry command should render provider descriptors', () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, createGatewayConfig())

    const output = runCommand(commands, 'elysia.gateway.registry')

    expect(output).toContain('Registered Providers')
    expect(output).toContain('- slot:reasoning')
    expect(output).toContain('type: gemini')
    expect(output).toContain('model: gemini-1.5-pro')
    expect(output).toContain('endpoint: https://gemini.example/v1beta')
    expect(output).toContain('- slot:fast')
    expect(output).toContain('type: openai-compatible')
    expect(output).toContain('endpoint: https://compatible.example/v1')
    expect(output).not.toContain('secret-key')
  })

  it('health command should render all and single provider health snapshots', async () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, createGatewayConfig())

    const gateway = ctx['elysia-ai-model-gateway']
    const provider = gateway.getRegistry().resolveSlot('fast')!
    provider.execute = vi.fn(async () => ({
      output: 'ok',
      messages: [{ role: 'assistant' as const, content: 'ok' }],
      provider: {
        id: 'slot:fast',
        type: 'openai-compatible' as const,
        model: 'fast-model',
      },
      finishReason: 'stop',
      latencyMs: 12,
      metadata: {
        providerLatencyMs: 12,
      },
    }))

    await gateway.execute({
      task: 'debug-health',
      slot: 'fast',
      messages: [{ role: 'user', content: 'health' }],
    })

    const allOutput = runCommand(commands, 'elysia.gateway.health [providerId:string]', {})
    expect(allOutput).toContain('Provider Health')
    expect(allOutput).toContain('- slot:fast')
    expect(allOutput).toContain('status: healthy')
    expect(allOutput).toContain('recentSuccesses: 1')
    expect(allOutput).toContain('averageLatencyMs: 12')

    const singleOutput = runCommand(commands, 'elysia.gateway.health [providerId:string]', {}, 'slot:fast')
    expect(singleOutput).toContain('Provider Health: slot:fast')
    expect(singleOutput).toContain('- slot:fast')
    expect(singleOutput).toContain('recentSuccesses: 1')
  })

  it('failures command should show friendly message when observatory is unavailable', () => {
    const { ctx, commands } = createCommandRecordingContext()

    apply(ctx, createGatewayConfig())

    const output = runCommand(commands, 'elysia.gateway.failures [limit:number]', {}, 10)

    expect(output).toBe('Observatory service not available. Please enable elysia-ai-observatory.')
  })

  it('failures command should render recent gateway failed traces from observatory', () => {
    const observatory = {
      service: {
        getRecentEvents: vi.fn(() => [
          {
            event: 'gateway.responded',
            timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
            metadata: {},
          },
          {
            event: 'gateway.failed',
            timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
            metadata: {
              diagnostics: {
                finalErrorCode: 'http-503',
                selectedFallbackSlot: 'fast',
                route: {
                  slot: 'reasoning',
                  providerId: 'slot:reasoning',
                },
              },
            },
          },
        ]),
      },
    }
    const { ctx, commands } = createCommandRecordingContext(observatory)

    apply(ctx, createGatewayConfig())

    const output = runCommand(commands, 'elysia.gateway.failures [limit:number]', {}, 5)

    expect(output).toContain('Recent Gateway Failures')
    expect(output).toContain('2026-01-01T00:00:01.000Z')
    expect(output).toContain('provider: slot:reasoning')
    expect(output).toContain('slot: reasoning')
    expect(output).toContain('code: http-503')
    expect(output).toContain('fallback: fast')
    expect(observatory.service.getRecentEvents).toHaveBeenCalledWith(25)
  })
})
