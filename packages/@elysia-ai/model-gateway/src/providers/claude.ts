import type { DialogueMessage } from '@elysia-ai/core'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import {
  createHttpProviderError,
  createProviderApiError,
  fetchWithTimeout,
  normalizeClaudeFinishReason,
  readResponseBody,
} from './utils.js'

function extractSystem(messages: DialogueMessage[]): string | undefined {
  const sys = messages.filter((m) => m.role === 'system')
  if (sys.length === 0) return undefined
  return sys.map((m) => m.content).join('\n')
}

function toClaudeMessages(messages: DialogueMessage[]) {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
}

export function createClaudeProvider(config: ProviderConfig): Provider {
  const baseUrl = (config.endpoint ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '')
  const maxTokens = config.maxTokens ?? 4096
  const temperature = config.temperature ?? 0.7
  const timeoutMs = config.timeoutMs

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'claude',
      model: config.model,
      endpoint: baseUrl,
    },
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      const model = request.model ?? config.model
      const mt = request.maxTokens ?? maxTokens
      const temp = request.temperature ?? temperature
      const timeout = request.timeoutMs ?? timeoutMs

      const url = `${baseUrl}/messages`

      const system = extractSystem(request.messages)
      const claudeMessages = toClaudeMessages(request.messages)

      const body: Record<string, unknown> = {
        model,
        max_tokens: mt,
        temperature: temp,
        messages: claudeMessages,
      }

      if (system) {
        body.system = system
      }

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
        throw createHttpProviderError('Claude', config.id, res, responseBody)
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Claude', config.id, json)
      }

      let output = ''
      if (Array.isArray(json.content)) {
        for (const block of json.content) {
          if (block.type === 'text') {
            output += block.text
          }
        }
      }

      const finishReason = normalizeClaudeFinishReason(json.stop_reason)
      const inputTokens = json.usage?.input_tokens
      const outputTokens = json.usage?.output_tokens
      const totalTokens = typeof inputTokens === 'number' && typeof outputTokens === 'number'
        ? inputTokens + outputTokens
        : undefined
      const latencyMs = Date.now() - startedAt

      return {
        output,
        messages: [
          ...request.messages,
          { role: 'assistant', content: output },
        ],
        provider: {
          id: config.id,
          type: 'claude',
          model: json.model ?? model,
          endpoint: baseUrl,
        },
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
        },
        finishReason,
        latencyMs,
        metadata: {
          responseId: json.id,
          model: json.model,
          providerLatencyMs: latencyMs,
          latencyMs,
        },
      }
    },
  }
}
