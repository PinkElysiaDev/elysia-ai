import { decodeMessagesResponse, encodeMessagesRequest, extractMessageText } from '@elysia-ai/protocol-anthropic'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import {
  createHttpProviderError,
  createProviderApiError,
  fetchWithTimeout,
  normalizeClaudeFinishReason,
  providerWireFormat,
  readResponseBody,
} from './utils.js'
import { toMaheshvaraRequest } from './maheshvara-bridge.js'
import { extractToolCalls } from './extract-tool-calls.js'

const DEFAULT_ENDPOINT = '/v1'

export function createAnthropicProvider(config: ProviderConfig): Provider {
  if (!config.baseURL) {
    throw new Error(`anthropic provider "${config.id}" requires baseURL`)
  }

  const baseURL = config.baseURL.replace(/\/+$/, '')
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const fullBaseUrl = `${baseURL}${endpoint}`

  const maxTokens = config.maxTokens ?? 4096
  const temperature = config.temperature ?? 0.7
  // 默认超时兜底：provider 挂死会阻塞同 habitat 串行队列（全部后续消息排队等死）
  const timeoutMs = config.timeoutMs ?? 120_000

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'anthropic',
      model: config.model,
      endpoint: fullBaseUrl,
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

      const url = `${fullBaseUrl}/messages`
      const body = encodeMessagesRequest(maheshvara)

      const startedAt = Date.now()
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, timeout, config.id)

      if (!res.ok) {
        const responseBody = await readResponseBody(res)
        throw createHttpProviderError('Claude', config.id, res, responseBody, providerWireFormat('anthropic'))
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Claude', config.id, json, undefined, providerWireFormat('anthropic'))
      }

      const maheshvaraResponse = decodeMessagesResponse(json)
      const output = extractMessageText(maheshvaraResponse)
      const toolCalls = extractToolCalls(maheshvaraResponse)
      const finishReason = normalizeClaudeFinishReason(maheshvaraResponse.stop_reason)
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
          type: 'anthropic',
          model: maheshvaraResponse.model || model,
          endpoint: fullBaseUrl,
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
          model: maheshvaraResponse.model,
          providerLatencyMs: latencyMs,
          latencyMs,
        },
      }
    },
  }
}
