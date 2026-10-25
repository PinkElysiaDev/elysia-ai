/**
 * 自定义协议供应商：以 @elysia-ai/protocol-custom 的「协议即数据」引擎驱动
 * 任意线制上游。协议定义（CustomProtocolConfig JSON 或内置 preset）在供应商
 * 构造时整体校验一次，请求热路径只做渲染/映射。
 * 传输层（URL 拼接、鉴权三模式、query 注入）对齐 Go SendCustomProtocolRequest。
 */

import type { MaheshvaraResponse } from '@elysia-ai/maheshvara'
import { FORMAT_OPENAI_CHAT, parseUpstreamError } from '@elysia-ai/maheshvara'
import { extractMessageText } from '@elysia-ai/protocol-openai'
import {
  customProtocolResponseFromRoot,
  renderCustomProtocolRequestUnchecked,
  resolveCustomMapping,
  validateCustomProtocol,
} from '@elysia-ai/protocol-custom'
import type { CustomProtocolConfig } from '@elysia-ai/protocol-custom'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import { ProviderError } from './types.js'
import { fetchWithTimeout, providerErrorRetryable, readResponseBody } from './utils.js'
import { extractToolCalls } from './extract-tool-calls.js'
import { toMaheshvaraRequest } from './maheshvara-bridge.js'

/** 解析协议引用：优先 protocols 字典，其次内置 preset id。 */
export function resolveProtocolDefinition(
  reference: string | undefined,
  protocols: Record<string, unknown> | undefined,
  presets: CustomProtocolConfig[],
): unknown {
  if (!reference) return undefined
  if (protocols && reference in protocols) return protocols[reference]
  return presets.find((preset) => preset.id === reference)
}

export function createCustomProvider(config: ProviderConfig, presets: CustomProtocolConfig[] = []): Provider {
  if (!config.baseURL) {
    throw new Error(`custom provider "${config.id}" requires baseURL`)
  }
  if (config.protocolConfig === undefined || config.protocolConfig === null) {
    throw new Error(`custom provider "${config.id}" requires a resolvable protocol (config.protocol references protocols dict or a preset id)`)
  }
  const protocol = config.protocolConfig as CustomProtocolConfig
  // 注册期整体校验（含双模板渲染）：非法协议配置启动即失败，不带病运行。
  try {
    validateCustomProtocol(protocol)
  } catch (error) {
    throw new Error(`custom provider "${config.id}" has invalid protocol: ${(error as Error).message}`)
  }

  const baseURL = config.baseURL.replace(/\/+$/, '')
  const maxTokens = config.maxTokens ?? 4096
  const temperature = config.temperature ?? 0.7
  const timeoutMs = config.timeoutMs ?? 120_000

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'custom',
      model: config.model,
      endpoint: baseURL,
    },
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      const model = request.model ?? config.model
      const maheshvara = toMaheshvaraRequest(request, {
        model,
        maxTokens: request.maxTokens ?? maxTokens,
        temperature: request.temperature ?? temperature,
        ...(config.maxTokensField ? { maxTokensField: config.maxTokensField } : {}),
      })
      const timeout = request.timeoutMs ?? timeoutMs

      const rendered = renderCustomProtocolRequestUnchecked(maheshvara, protocol)
      const target = buildCustomTarget(baseURL, rendered.path, rendered.query, rendered.headers, rendered.auth, config)

      const startedAt = Date.now()
      const res = await fetchWithTimeout(target.url, {
        method: rendered.method,
        headers: target.headers,
        ...(rendered.body !== undefined ? { body: rendered.body } : {}),
      }, timeout, config.id)

      if (!res.ok) {
        const responseBody = await readResponseBody(res)
        throw customUpstreamError(config.id, res.status, responseBody, protocol)
      }

      const json = await res.json() as any
      const maheshvaraResponse = mapCustomResponse(json, protocol)
      if (maheshvaraResponse.error) {
        throw customMappedError(config.id, maheshvaraResponse.error, undefined)
      }

      const output = extractMessageText(maheshvaraResponse)
      const toolCalls = extractToolCalls(maheshvaraResponse)
      const finishReason = maheshvaraResponse.stop_reason ?? 'unknown'
      const latencyMs = Date.now() - startedAt

      return {
        output,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        messages: [
          ...request.messages,
          { role: 'assistant', content: output, ...(toolCalls.length ? { toolCalls } : {}) },
        ],
        provider: {
          id: config.id,
          type: 'custom',
          model,
          endpoint: baseURL,
        },
        usage: {
          inputTokens: maheshvaraResponse.usage?.input_tokens,
          outputTokens: maheshvaraResponse.usage?.output_tokens,
          totalTokens: maheshvaraResponse.usage?.total_tokens,
        },
        finishReason,
        latencyMs,
        metadata: {
          responseId: maheshvaraResponse.id,
          latencyMs,
        },
      }
    },
  }
}

interface CustomTarget {
  url: string
  headers: Record<string, string>
}

/** URL 拼接 + query 注入 + 鉴权三模式（对齐 Go SendCustomProtocolRequest 的传输准备段）。 */
function buildCustomTarget(
  baseURL: string,
  path: string,
  query: Record<string, string>,
  renderedHeaders: Record<string, string>,
  auth: { mode?: string; header?: string; prefix?: string; query?: string },
  config: ProviderConfig,
): CustomTarget {
  let target = baseURL
  if (path.trim() !== '') {
    if (path.includes('://')) {
      throw new Error(`custom provider "${config.id}" protocol path must be relative to the configured base URL`)
    }
    target = `${baseURL}/${path.replace(/^\/+/, '')}`
  }
  const url = new URL(target)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }

  const authMode = (auth.mode ?? '').trim().toLowerCase() || 'bearer'
  if (authMode === 'query' && (auth.query ?? '').trim() !== '' && config.apiKey) {
    url.searchParams.set(auth.query!, config.apiKey)
  }

  const headers: Record<string, string> = { ...renderedHeaders }
  if (authMode === 'bearer' && config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  } else if (authMode === 'header' && config.apiKey) {
    const header = (auth.header ?? '').trim() !== '' ? auth.header!.trim() : 'x-api-key'
    headers[header] = `${auth.prefix ?? ''}${config.apiKey}`
  }
  return { url: url.toString(), headers }
}

/** 非流式 200 响应映射：payloadPath 解包 + 路径映射 → MaheshvaraResponse。 */
function mapCustomResponse(body: unknown, protocol: CustomProtocolConfig): MaheshvaraResponse {
  const resolved = resolveCustomMapping(protocol, false)
  return customProtocolResponseFromRoot(body, resolved, protocol.aliases, protocol.id, false)
}

/** 非 200：优先协议引擎的 errorPath 映射，无映射时回退 OpenAI 信封通用解析。 */
function customUpstreamError(providerId: string, status: number, body: unknown, protocol: CustomProtocolConfig): ProviderError {
  try {
    const resolved = resolveCustomMapping(protocol, false)
    const mapped = customProtocolResponseFromRoot(body, resolved, protocol.aliases, protocol.id, true)
    if (mapped.error) {
      return customMappedError(providerId, mapped.error, status)
    }
  } catch {
    // 映射失败落入通用解析
  }
  const parsed = parseUpstreamError(FORMAT_OPENAI_CHAT, status, body)
  const upstreamMessage = parsed.message === '' || parsed.message === 'upstream request failed' || parsed.message.startsWith('upstream error: ')
    ? undefined
    : parsed.message
  return new ProviderError(
    upstreamMessage !== undefined
      ? `Custom API failed (${status} ${parsed.class}): ${upstreamMessage}`
      : `Custom API failed: ${status}`,
    providerId,
    status,
    body,
    {
      retryable: providerErrorRetryable(status, parsed.class),
      code: `http-${status}`,
      class: parsed.class,
    },
  )
}

/** 协议引擎映射出的错误 → ProviderError（class=upstream，Go 引擎固定分类）。 */
function customMappedError(providerId: string, error: { message: string; class?: string; raw?: Record<string, unknown> }, status: number | undefined): ProviderError {
  // 引擎的 message 是错误对象 JSON 文本（Go 语义）；raw.message 存在时优先真实文案。
  const rawMessage = typeof error.raw?.['message'] === 'string' ? error.raw['message'] as string : ''
  const message = rawMessage !== '' ? rawMessage : error.message
  return new ProviderError(
    `Custom API failed${status ? ` (${status})` : ''}: ${message}`,
    providerId,
    status,
    error.raw,
    {
      retryable: providerErrorRetryable(status, error.class),
      code: status ? `http-${status}` : 'api-error',
      class: error.class,
    },
  )
}
