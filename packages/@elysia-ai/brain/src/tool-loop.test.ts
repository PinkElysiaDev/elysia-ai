import { describe, expect, it, vi } from 'vitest'
import type { BrainRequest, BrainResponse, BrainService, DialogueMessage } from '@elysia-ai/core'
import { runBrainToolLoop } from './tool-loop.js'

function mockBrain(responses: BrainResponse[]): BrainService & { requests: BrainRequest[] } {
  const requests: BrainRequest[] = []
  let index = 0
  const service: BrainService = {
    async execute(request: BrainRequest): Promise<BrainResponse> {
      requests.push(request)
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return response
    },
  }
  return Object.assign(service, { requests })
}

describe('runBrainToolLoop（调用方驱动的工具循环）', () => {
  const baseRequest: BrainRequest = {
    task: 'agentic-dialogue',
    messages: [{ role: 'user', content: '群里有人@你' }],
  }

  it('模型请求工具 → 执行 → 回填 → 二轮纯文本收尾', async () => {
    const brain = mockBrain([
      {
        output: '',
        toolCalls: [{ id: 'c1', type: 'function', name: 'stay_silent', arguments: '{"reason":"无聊"}' }],
        messages: [
          { role: 'user', content: '群里有人@你' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'c1', type: 'function', name: 'stay_silent', arguments: '{"reason":"无聊"}' }] },
        ],
      },
      { output: '已沉默', messages: [] },
    ])
    const executor = vi.fn().mockResolvedValue({ ok: true, silent: true })

    const result = await runBrainToolLoop(brain, baseRequest, [
      { definition: { name: 'stay_silent', description: '保持沉默', parameters: { type: 'object' } }, execute: executor },
    ])

    expect(result.stopReason).toBe('completed')
    expect(result.rounds).toBe(2)
    expect(result.output).toBe('已沉默')
    expect(result.toolCalls).toHaveLength(1)
    expect(executor).toHaveBeenCalledWith({ reason: '无聊' })
    // 工具结果以 tool 角色消息回填
    const toolMessage = result.messages.find((m) => m.role === 'tool') as DialogueMessage
    expect(toolMessage.toolCallId).toBe('c1')
    expect(toolMessage.name).toBe('stay_silent')
    expect(JSON.parse(toolMessage.content)).toEqual({ ok: true, silent: true })
    // 第一轮请求携带工具定义
    expect(brain.requests[0].tools).toEqual([
      { name: 'stay_silent', description: '保持沉默', parameters: { type: 'object' } },
    ])
    // 第二轮请求包含 tool 回填
    expect(brain.requests[1].messages.some((m) => m.role === 'tool')).toBe(true)
  })

  it('多轮工具循环：每轮请求 system 消息恰 1 条（回显 system 剥离，无逐轮累积）', async () => {
    const call = { id: 'c1', type: 'function', name: 'send_reply', arguments: '{}' }
    // 模拟真实链：brain 回显含本轮插入的 system（gateway 全量回显）
    let round = 0
    const requests: BrainRequest[] = []
    const brain = {
      async execute(request: BrainRequest): Promise<BrainResponse> {
        requests.push(request)
        round += 1
        const gatewayMessages = [
          { role: 'system' as const, content: 'persona prompt' },
          ...request.messages,
        ]
        if (round < 4) {
          const assistant = { role: 'assistant' as const, content: '', toolCalls: [call] }
          return { output: '', toolCalls: [call], messages: [...gatewayMessages, assistant] }
        }
        const assistant = { role: 'assistant' as const, content: 'done' }
        return { output: 'done', messages: [...gatewayMessages, assistant] }
      },
    } as BrainService

    const result = await runBrainToolLoop(brain, baseRequest, [
      { definition: { name: 'send_reply' }, execute: async () => 'ok' },
    ], { maxRounds: 4 })

    expect(result.output).toBe('done')
    expect(requests).toHaveLength(4)
    for (const [index, request] of requests.entries()) {
      const systemCount = request.messages.filter((message) => message.role === 'system').length
      expect(systemCount, `round ${index + 1}`).toBe(0)  // 循环侧不带 system（brain 每轮自行插入恰 1 条）
    }
  })

  it('模型直接纯文本回复：不执行任何工具', async () => {
    const brain = mockBrain([{ output: '你好呀', messages: [] }])
    const executor = vi.fn()

    const result = await runBrainToolLoop(brain, baseRequest, [
      { definition: { name: 'send_reply' }, execute: executor },
    ])

    expect(result.stopReason).toBe('completed')
    expect(result.rounds).toBe(1)
    expect(result.output).toBe('你好呀')
    expect(result.toolCalls).toHaveLength(0)
    expect(executor).not.toHaveBeenCalled()
  })

  it('未知工具名与执行异常以错误文本回填，循环继续', async () => {
    const brain = mockBrain([
      {
        output: '',
        toolCalls: [
          { id: 'c1', type: 'function', name: 'nope', arguments: '{}' },
          { id: 'c2', type: 'function', name: 'boom', arguments: '{}' },
        ],
        messages: [],
      },
      { output: '修好了', messages: [] },
    ])

    const result = await runBrainToolLoop(brain, baseRequest, [
      { definition: { name: 'boom' }, execute: async () => { throw new Error('炸了') } },
    ])

    expect(result.output).toBe('修好了')
    const toolMessages = result.messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(JSON.parse(toolMessages[0].content).code).toBe('unknown-tool')
    expect(JSON.parse(toolMessages[1].content).code).toBe('tool-error')
  })

  it('超过 maxRounds 截断并标记 max-rounds', async () => {
    const call = { id: 'c', type: 'function', name: 'loop_forever', arguments: '{}' }
    const brain = mockBrain([
      { output: '', toolCalls: [call], messages: [] },
      { output: '', toolCalls: [call], messages: [] },
      { output: '', toolCalls: [call], messages: [] },
    ])

    const result = await runBrainToolLoop(
      brain,
      baseRequest,
      [{ definition: { name: 'loop_forever' }, execute: async () => 'ok' }],
      { maxRounds: 3 },
    )

    expect(result.stopReason).toBe('max-rounds')
    expect(result.rounds).toBe(3)
    expect(result.toolCalls).toHaveLength(3)
  })

  it('对象参数（anthropic 风格）与字符串参数（openai/gemini 风格）均可归一', async () => {
    const brain = mockBrain([
      {
        output: '',
        toolCalls: [
          { id: 'c1', type: 'function', name: 'send_reply', arguments: { text: '对象参数' } },
          { id: 'c2', type: 'function', name: 'send_reply', arguments: '{"text":"字符串参数"}' },
        ],
        messages: [],
      },
      { output: '完成', messages: [] },
    ])
    const received: Array<Record<string, unknown>> = []

    await runBrainToolLoop(brain, baseRequest, [
      { definition: { name: 'send_reply' }, execute: async (args) => { received.push(args); return 'ok' } },
    ])

    expect(received).toEqual([{ text: '对象参数' }, { text: '字符串参数' }])
  })
})
