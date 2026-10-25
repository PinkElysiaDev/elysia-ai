import { decodeResponsesResponse, encodeResponsesRequest, extractMessageText } from '@elysia-ai/protocol-responses'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import { createHttpProviderError, createProviderApiError, fetchWithTimeout, readResponseBody, normalizeResponsesFinishReason, providerWireFormat } from './utils.js'
import { toMaheshvaraRequest } from './maheshvara-bridge.js'
import { extractToolCalls } from './extract-tool-calls.js'

const DEFAULT_ENDPOINT = '/v1'

export function createResponsesProvider(config: ProviderConfig): Provider {
  if (!config.baseURL) {
    throw new Error(`responses provider "${config.id}" requires baseURL`)
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
      type: 'responses',
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

      const url = `${fullBaseUrl}/responses`
      const body = encodeResponsesRequest(maheshvara)

      const startedAt = Date.now()
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, timeout, config.id)

      if (!res.ok) {
        const responseBody = await readResponseBody(res)
        throw createHttpProviderError('Responses', config.id, res, responseBody, providerWireFormat('responses'))
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Responses', config.id, json, undefined, providerWireFormat('responses'))
      }

      const maheshvaraResponse = decodeResponsesResponse(json)
      let output = extractMessageText(maheshvaraResponse)
      if (!output && typeof (json as any).output_text === 'string') {
        output = (json as any).output_text
      }
      const toolCalls = extractToolCalls(maheshvaraResponse)

      // status 是生命周期状态而非停止原因；截断/过滤须看 incomplete_details
      const finishReason = normalizeResponsesFinishReason(
        json.status,
        typeof json.incomplete_details === 'object' && json.incomplete_details !== null
          ? (json.incomplete_details as { reason?: unknown }).reason
          : undefined,
      )
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
          type: 'responses',
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
          responseId: maheshvaraResponse.id,
          latencyMs,
        },
      }
    },
  }
}
