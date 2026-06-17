import type { DialogueMessage } from '@elysia-ai/core'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import {
  createHttpProviderError,
  createProviderApiError,
  fetchWithTimeout,
  normalizeGeminiFinishReason,
  readResponseBody,
} from './utils.js'

function toGeminiContents(messages: DialogueMessage[]) {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  for (const m of messages) {
    if (m.role === 'system') continue
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })
  }

  return contents
}

function extractSystemInstruction(messages: DialogueMessage[]): string | undefined {
  const systemMessages = messages.filter((m) => m.role === 'system')
  if (systemMessages.length === 0) return undefined
  return systemMessages.map((m) => m.content).join('\n')
}

export function createGeminiProvider(config: ProviderConfig): Provider {
  const baseUrl = (
    config.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta'
  ).replace(/\/+$/, '')
  const maxTokens = config.maxTokens ?? 4096
  const temperature = config.temperature ?? 0.7
  const timeoutMs = config.timeoutMs

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'gemini',
      model: config.model,
      endpoint: baseUrl,
    },
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      const model = request.model ?? config.model
      const mt = request.maxTokens ?? maxTokens
      const temp = request.temperature ?? temperature
      const timeout = request.timeoutMs ?? timeoutMs

      const url = `${baseUrl}/models/${model}:generateContent?key=${config.apiKey}`

      const systemInstruction = extractSystemInstruction(request.messages)
      const contents = toGeminiContents(request.messages)

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: mt,
          temperature: temp,
        },
      }

      if (systemInstruction) {
        body.systemInstruction = {
          parts: [{ text: systemInstruction }],
        }
      }

      const startedAt = Date.now()
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, timeout, config.id)

      if (!res.ok) {
        const responseBody = await readResponseBody(res)
        throw createHttpProviderError('Gemini', config.id, res, responseBody)
      }

      const json = await res.json() as any

      if (json.error) {
        throw createProviderApiError('Gemini', config.id, json, json.error.code)
      }

      const candidate = json.candidates?.[0]
      const output = candidate?.content?.parts
        ?.map((p: any) => p.text ?? '')
        .join('') ?? ''
      const finishReason = normalizeGeminiFinishReason(candidate?.finishReason)
      const latencyMs = Date.now() - startedAt

      return {
        output,
        messages: [
          ...request.messages,
          { role: 'assistant', content: output },
        ],
        provider: {
          id: config.id,
          type: 'gemini',
          model,
          endpoint: baseUrl,
        },
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount,
          outputTokens: json.usageMetadata?.candidatesTokenCount,
          totalTokens: json.usageMetadata?.totalTokenCount,
        },
        finishReason,
        latencyMs,
        metadata: {
          modelVersion: json.modelVersion,
          providerLatencyMs: latencyMs,
          latencyMs,
        },
      }
    },
  }
}
