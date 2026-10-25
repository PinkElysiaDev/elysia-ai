import { decodeGenerateContentResponse, encodeGenerateContentRequest, extractMessageText } from '@elysia-ai/protocol-gemini'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import {
  createHttpProviderError,
  createProviderApiError,
  fetchWithTimeout,
  normalizeGeminiFinishReason,
  providerWireFormat,
  readResponseBody,
} from './utils.js'
import { toMaheshvaraRequest } from './maheshvara-bridge.js'
import { extractToolCalls } from './extract-tool-calls.js'

const DEFAULT_ENDPOINT = '/v1beta'

export function createGeminiProvider(config: ProviderConfig): Provider {
  if (!config.baseURL) {
    throw new Error(`gemini provider "${config.id}" requires baseURL`)
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
      type: 'gemini',
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

      // P2-11：密钥改 x-goog-api-key 头（官方支持）——此前 ?key= 明文进
      // URL：落入代理/访问日志与错误 diagnostics，且含 &/+/# 等字符会被截断。
      const url = `${fullBaseUrl}/models/${encodeURIComponent(model)}:generateContent`
      const body = encodeGenerateContentRequest(maheshvara)

      const startedAt = Date.now()
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, timeout, config.id)

      if (!res.ok) {
        const responseBody = await readResponseBody(res)
        throw createHttpProviderError('Gemini', config.id, res, responseBody, providerWireFormat('gemini'))
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Gemini', config.id, json, json.error.code, providerWireFormat('gemini'))
      }

      const maheshvaraResponse = decodeGenerateContentResponse(json)
      const output = extractMessageText(maheshvaraResponse)
      const toolCalls = extractToolCalls(maheshvaraResponse)
      const finishReason = normalizeGeminiFinishReason(maheshvaraResponse.stop_reason)
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
          type: 'gemini',
          model,
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
          modelVersion: maheshvaraResponse.model,
          providerLatencyMs: latencyMs,
          latencyMs,
        },
      }
    },
  }
}
