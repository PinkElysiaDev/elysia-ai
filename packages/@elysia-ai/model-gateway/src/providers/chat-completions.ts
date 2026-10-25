import { decodeChatCompletionsResponse, encodeChatCompletionsRequest, extractMessageText } from '@elysia-ai/protocol-openai'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import { createHttpProviderError, createProviderApiError, fetchWithTimeout, providerWireFormat, readResponseBody } from './utils.js'
import { extractToolCalls } from './extract-tool-calls.js'
import { toMaheshvaraRequest } from './maheshvara-bridge.js'

const DEFAULT_ENDPOINT = '/v1'

export function createChatCompletionsProvider(config: ProviderConfig): Provider {
  if (!config.baseURL) {
    throw new Error(`chat-completions provider "${config.id}" requires baseURL`)
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
      type: 'chat-completions',
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

      const url = `${fullBaseUrl}/chat/completions`
      const body = encodeChatCompletionsRequest(maheshvara)

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
        throw createHttpProviderError('Chat Completions', config.id, res, responseBody, providerWireFormat('chat-completions'))
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Chat Completions', config.id, json, undefined, providerWireFormat('chat-completions'))
      }

      const maheshvaraResponse = decodeChatCompletionsResponse(json)
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
          type: 'chat-completions',
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
