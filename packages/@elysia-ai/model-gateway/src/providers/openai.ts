import type { DialogueMessage } from '@elysia-ai/core'
import type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
import { ProviderError } from './types.js'

function toOpenAIMessages(messages: DialogueMessage[]) {
  return messages.map((m) => ({
    role: m.role as string,
    content: m.content,
    ...(m.name ? { name: m.name } : {}),
  }))
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined,
  providerId: string,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, init)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(
        `Provider "${providerId}" request timed out after ${timeoutMs}ms`,
        providerId,
        undefined,
        undefined,
        {
          retryable: true,
          code: 'timeout',
          cause: error,
        },
      )
    }
    throw new ProviderError(
      `Provider "${providerId}" request failed: ${error instanceof Error ? error.message : String(error)}`,
      providerId,
      undefined,
      undefined,
      {
        retryable: true,
        code: 'network-error',
        cause: error,
      },
    )
  } finally {
    clearTimeout(timer)
  }
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: DialogueMessage[],
  maxTokens: number,
  temperature: number,
  providerId: string,
  timeoutMs?: number
): Promise<ProviderResponse> {
  const url = `${baseUrl}/chat/completions`
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    max_tokens: maxTokens,
    temperature,
  }

  const startedAt = Date.now()
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs, providerId)

  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ProviderError(
      `OpenAI chat/completions failed: ${res.status} ${res.statusText}`,
      providerId,
      res.status,
      body,
      {
        retryable: isRetryableStatus(res.status),
        code: `http-${res.status}`,
      },
    )
  }

  const json = await res.json() as any

  if (json.error) {
    throw new ProviderError(
      `OpenAI API error: ${json.error.message ?? JSON.stringify(json.error)}`,
      providerId,
      undefined,
      json,
      {
        retryable: true,
        code: 'api-error',
      },
    )
  }

  const choice = json.choices?.[0]
  const output = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason ?? 'unknown'

  return {
    output,
    messages: [
      ...messages,
      { role: 'assistant', content: output },
    ],
    provider: {
      id: providerId,
      type: 'openai',
      model,
    },
    usage: {
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
    },
    finishReason,
    latencyMs: Date.now() - startedAt,
    metadata: {
      responseId: json.id,
      created: json.created,
      latencyMs: Date.now() - startedAt,
    },
  }
}

async function callResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: DialogueMessage[],
  maxTokens: number,
  temperature: number,
  providerId: string,
  timeoutMs?: number
): Promise<ProviderResponse> {
  const url = `${baseUrl}/responses`

  const input = messages.map((m) => ({
    role: m.role as string,
    content: m.content,
  }))

  const body = {
    model,
    input,
    max_output_tokens: maxTokens,
    temperature,
  }

  const startedAt = Date.now()
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs, providerId)

  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ProviderError(
      `OpenAI responses failed: ${res.status} ${res.statusText}`,
      providerId,
      res.status,
      body,
      {
        retryable: isRetryableStatus(res.status),
        code: `http-${res.status}`,
      },
    )
  }

  const json = await res.json() as any

  if (json.error) {
    throw new ProviderError(
      `OpenAI responses API error: ${json.error.message ?? JSON.stringify(json.error)}`,
      providerId,
      undefined,
      json,
      {
        retryable: true,
        code: 'api-error',
      },
    )
  }

  // Responses API: output is an array of output items
  let output = ''
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text') {
            output += part.text
          }
        }
      }
    }
  }

  if (!output && typeof json.output_text === 'string') {
    output = json.output_text
  }

  return {
    output,
    messages: [
      ...messages,
      { role: 'assistant', content: output },
    ],
    provider: {
      id: providerId,
      type: 'openai',
      model,
    },
    usage: {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
      totalTokens: json.usage?.total_tokens,
    },
    finishReason: json.status ?? 'unknown',
    latencyMs: Date.now() - startedAt,
    metadata: {
      responseId: json.id,
      latencyMs: Date.now() - startedAt,
    },
  }
}

export function createOpenAIProvider(config: ProviderConfig): Provider {
  const baseUrl = (config.endpoint ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const mode = config.mode ?? 'chat-completions'
  const maxTokens = config.maxTokens ?? 4096
  const temperature = config.temperature ?? 0.7
  const timeoutMs = config.timeoutMs

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'openai',
      model: config.model,
      endpoint: baseUrl,
    },
    async execute(request: ProviderRequest): Promise<ProviderResponse> {
      const model = request.model ?? config.model
      const mt = request.maxTokens ?? maxTokens
      const temp = request.temperature ?? temperature

      const timeout = request.timeoutMs ?? timeoutMs

      if (mode === 'responses') {
        return callResponses(baseUrl, config.apiKey, model, request.messages, mt, temp, config.id, timeout)
      }
      return callChatCompletions(baseUrl, config.apiKey, model, request.messages, mt, temp, config.id, timeout)
    },
  }
}
