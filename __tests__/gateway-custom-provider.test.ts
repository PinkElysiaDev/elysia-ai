import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCustomProvider, resolveProtocolDefinition } from '../packages/@elysia-ai/model-gateway/src/providers/custom.js'
import { createProvider } from '../packages/@elysia-ai/model-gateway/src/providers/index.js'
import { createChatCompletionsProvider } from '../packages/@elysia-ai/model-gateway/src/providers/chat-completions.js'
import { createAnthropicProvider } from '../packages/@elysia-ai/model-gateway/src/providers/anthropic.js'
import type { ProviderConfig, ProviderError } from '../packages/@elysia-ai/model-gateway/src/providers/types.js'
import { CUSTOM_PROTOCOL_PRESETS, ANTHROPIC_MESSAGES_PRESET } from '../packages/@elysia-ai/protocol-custom/src/index.js'
import { validateModelGatewayConfig } from '../packages/elysia-ai-model-gateway/src/index.js'

/**
 * custom 供应商类型（@elysia-ai/protocol-custom 引擎）接入 gateway 的回归：
 * 协议即数据——JSON 协议定义驱动任意线制上游的请求渲染与响应映射。
 */

const BASE = {
  id: 'dashscope',
  apiKey: 'sk-custom',
  baseURL: 'https://dashscope.example.com',
  model: 'qwen-max',
} as const

const SIMPLE_REQUEST = { messages: [{ role: 'user', content: '讲个笑话' }] }

const DASHSCOPE_PROTOCOL = {
  id: 'dashscope',
  request: {
    method: 'POST',
    path: '/api/v1/services/aigc/text-generation/generation',
    auth: { mode: 'bearer' },
    body: {
      model: { field: 'model', mode: 'string' },
      input: { messages: { field: 'messages' } },
      parameters: {
        max_tokens: { field: 'max_output_tokens', omitIfEmpty: true },
        temperature: { field: 'temperature', omitIfEmpty: true },
      },
    },
  },
  response: {
    textPath: 'output.choices[0].message.content',
    usagePath: 'usage',
    finishReasonPath: 'output.choices[0].finish_reason',
  },
}

function mockJsonResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('custom 供应商：请求渲染与响应映射全链路', () => {
  it('DashScope 风格协议：URL/鉴权/请求体树渲染 + 响应映射', async () => {
    const fetchMock = mockJsonResponse(200, {
      output: {
        choices: [{ message: { role: 'assistant', content: '好冷的笑话' }, finish_reason: 'stop' }],
      },
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      request_id: 'req-1',
    })
    const provider = createProvider({ ...BASE, type: 'custom', protocolConfig: DASHSCOPE_PROTOCOL } as ProviderConfig)

    const response = await provider.execute(SIMPLE_REQUEST)

    // 请求侧：路径拼接 + Bearer + 注解树渲染的请求体
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://dashscope.example.com/api/v1/services/aigc/text-generation/generation')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-custom')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['model']).toBe('qwen-max')
    expect(Array.isArray((body['input'] as Record<string, unknown>)['messages'])).toBe(true)
    expect((body['parameters'] as Record<string, unknown>)['max_tokens']).toBe(4096)

    // 响应侧：textPath/usagePath/finishReasonPath 映射
    expect(response.output).toBe('好冷的笑话')
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 })
    expect(response.finishReason).toBe('stop')
    expect(response.provider.type).toBe('custom')
  })

  it('header 鉴权模式：自定义头 + 前缀', async () => {
    const fetchMock = mockJsonResponse(200, { output: { text: 'ok' } })
    const provider = createCustomProvider({
      ...BASE,
      type: 'custom',
      protocolConfig: {
        id: 'p',
        request: {
          path: '/x',
          auth: { mode: 'header', header: 'x-custom-key', prefix: 'Bearer ' },
          body: { q: { field: 'model', mode: 'string' } },
        },
        response: { textPath: 'output.text' },
      },
    })
    await provider.execute(SIMPLE_REQUEST)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['x-custom-key']).toBe('Bearer sk-custom')
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('query 鉴权模式：密钥进 query 参数', async () => {
    const fetchMock = mockJsonResponse(200, { output: { text: 'ok' } })
    const provider = createCustomProvider({
      ...BASE,
      type: 'custom',
      protocolConfig: {
        id: 'p',
        request: { path: '/x', auth: { mode: 'query', query: 'api_key' }, body: { q: { field: 'model', mode: 'string' } } },
        response: { textPath: 'output.text' },
      },
    })
    await provider.execute(SIMPLE_REQUEST)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('api_key=sk-custom')
  })

  it('非法协议配置：构造即报错（不带病运行）', () => {
    expect(() => createCustomProvider({
      ...BASE,
      type: 'custom',
      protocolConfig: { id: 'broken', request: { path: '/x', body: { m: { field: 'no_such_field' } } } },
    })).toThrow(/invalid protocol/)
    expect(() => createCustomProvider({ ...BASE, type: 'custom' })).toThrow(/requires a resolvable protocol/)
  })
})

describe('custom 供应商：错误映射', () => {
  it('协议 errorPath 映射：class=upstream，raw.message 优先为文案', async () => {
    mockJsonResponse(429, { error: { code: 'Throttling', message: 'Requests throttled' } })
    const provider = createCustomProvider({
      ...BASE,
      type: 'custom',
      protocolConfig: { id: 'p', request: { path: '/x', body: { q: { field: 'model', mode: 'string' } } }, response: { textPath: 'output.text', errorPath: 'error' } },
    })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('upstream')
    expect(error.statusCode).toBe(429)
    expect(error.message).toContain('Requests throttled')
    expect(error.retryable).toBe(true)
  })

  it('无 errorPath 时回退 OpenAI 信封通用解析', async () => {
    mockJsonResponse(429, { error: { message: 'Too many requests', type: 'rate_limit_error' } })
    const provider = createCustomProvider({
      ...BASE,
      type: 'custom',
      protocolConfig: { id: 'p', request: { path: '/x', body: { q: { field: 'model', mode: 'string' } } }, response: { textPath: 'output.text' } },
    })
    const error = await provider.execute(SIMPLE_REQUEST).catch((e: unknown) => e) as ProviderError
    expect(error.class).toBe('rate_limit')
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('Too many requests')
  })
})

describe('preset 引用与解析', () => {
  it('resolveProtocolDefinition：字典优先，其次 preset id', () => {
    const protocols = { 'my-openai': { id: 'my-openai' } }
    expect(resolveProtocolDefinition('my-openai', protocols, CUSTOM_PROTOCOL_PRESETS)).toEqual({ id: 'my-openai' })
    expect(resolveProtocolDefinition('anthropic-messages', protocols, CUSTOM_PROTOCOL_PRESETS)).toBe(ANTHROPIC_MESSAGES_PRESET)
    expect(resolveProtocolDefinition('nope', protocols, CUSTOM_PROTOCOL_PRESETS)).toBeUndefined()
  })

  it('protocol: anthropic-messages 与内置 anthropic 供应商行为对拍', async () => {
    const upstreamBody = {
      id: 'msg_1',
      content: [{ type: 'text', text: '同一份回复' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 4 },
    }

    const customFetch = mockJsonResponse(200, upstreamBody)
    const customProvider = createProvider({
      id: 'claude-custom',
      type: 'custom',
      apiKey: 'sk-ant',
      baseURL: 'https://api.anthropic.example.com',
      model: 'claude-x',
      protocolConfig: ANTHROPIC_MESSAGES_PRESET,
    } as ProviderConfig)
    const customResponse = await customProvider.execute(SIMPLE_REQUEST)
    const [customUrl, customInit] = customFetch.mock.calls[0] as [string, RequestInit]

    const builtinFetch = mockJsonResponse(200, upstreamBody)
    const builtin = createAnthropicProvider({
      id: 'claude-builtin',
      type: 'anthropic',
      apiKey: 'sk-ant',
      baseURL: 'https://api.anthropic.example.com',
      model: 'claude-x',
    })
    const builtinResponse = await builtin.execute(SIMPLE_REQUEST)
    const [builtinUrl, builtinInit] = builtinFetch.mock.calls[0] as [string, RequestInit]

    // 请求侧：同端点、同鉴权头族（x-api-key + anthropic-version）
    expect(customUrl).toBe(builtinUrl)
    const customHeaders = customInit.headers as Record<string, string>
    const builtinHeaders = builtinInit.headers as Record<string, string>
    expect(customHeaders['x-api-key']).toBe(builtinHeaders['x-api-key'])
    expect(customHeaders['anthropic-version']).toBe('2023-06-01')

    // 响应侧：正文与用量一致
    expect(customResponse.output).toBe(builtinResponse.output)
    expect(customResponse.usage).toEqual(builtinResponse.usage)
  })
})

describe('koishi 配置校验（custom 类型）', () => {
  it('custom 必须带可解析的 protocol', () => {
    const base = {
      providers: {
        c1: { type: 'custom', apiKey: 'k', baseURL: 'https://x.example.com' },
      },
    }
    expect(() => validateModelGatewayConfig(base as never)).toThrow(/requires protocol/)

    expect(() => validateModelGatewayConfig({
      ...base,
      providers: { c1: { ...base.providers.c1, protocol: 'no-such' } },
    } as never)).toThrow(/unknown protocol/)

    expect(() => validateModelGatewayConfig({
      providers: { c1: { ...base.providers.c1, protocol: 'openai-chat' } },
    } as never)).not.toThrow()

    expect(() => validateModelGatewayConfig({
      protocols: { mine: DASHSCOPE_PROTOCOL },
      providers: { c1: { ...base.providers.c1, protocol: 'mine' } },
    } as never)).not.toThrow()
  })
})

describe('maxTokensField（o 系模型字段名）', () => {
  it('max_completion_tokens 写入请求体而非 max_tokens', async () => {
    const fetchMock = mockJsonResponse(200, {
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const provider = createChatCompletionsProvider({
      id: 'o-series',
      type: 'chat-completions',
      apiKey: 'k',
      baseURL: 'https://api.example.com',
      model: 'o-preview',
      maxTokensField: 'max_completion_tokens',
    })
    await provider.execute(SIMPLE_REQUEST)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['max_completion_tokens']).toBe(4096)
    expect(body['max_tokens']).toBeUndefined()
  })
})
