import { ProviderError } from './types.js'

export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined
    || status === 408
    || status === 409
    || status === 429
    || status === 529
    || status >= 500
}

export async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function fetchWithTimeout(
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

export function createHttpProviderError(
  providerName: string,
  providerId: string,
  res: Response,
  responseBody: unknown,
): ProviderError {
  return new ProviderError(
    `${providerName} API failed: ${res.status} ${res.statusText}`,
    providerId,
    res.status,
    responseBody,
    {
      retryable: isRetryableStatus(res.status),
      code: `http-${res.status}`,
    },
  )
}

export function createProviderApiError(
  providerName: string,
  providerId: string,
  responseBody: unknown,
  statusCode?: number,
): ProviderError {
  return new ProviderError(
    `${providerName} API error: ${extractErrorMessage(responseBody)}`,
    providerId,
    statusCode,
    responseBody,
    {
      retryable: isRetryableStatus(statusCode),
      code: statusCode ? `http-${statusCode}` : 'api-error',
    },
  )
}

export function extractErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return String(value)

  const record = value as Record<string, any>
  return record.error?.message
    ?? record.message
    ?? record.error?.type
    ?? JSON.stringify(value)
}

export function normalizeGeminiFinishReason(reason: unknown): string {
  switch (reason) {
    case 'STOP':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter'
    case undefined:
    case null:
      return 'unknown'
    default:
      return String(reason).toLowerCase()
  }
}

export function normalizeClaudeFinishReason(reason: unknown): string {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case undefined:
    case null:
      return 'unknown'
    default:
      return String(reason)
  }
}
