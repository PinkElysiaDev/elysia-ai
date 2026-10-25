import {
  ERROR_CLASS_AUTHENTICATION,
  ERROR_CLASS_INVALID_REQUEST,
  ERROR_CLASS_MODEL_NOT_FOUND,
  ERROR_CLASS_OVERLOADED,
  ERROR_CLASS_PERMISSION,
  ERROR_CLASS_RATE_LIMIT,
  ERROR_CLASS_SERVER,
  ERROR_CLASS_UPSTREAM,
  FORMAT_CLAUDE,
  FORMAT_GEMINI,
  FORMAT_OPENAI_CHAT,
  FORMAT_RESPONSES,
  parseUpstreamError,
} from '@elysia-ai/maheshvara'
import type { ProviderConfig } from './types.js'
import { ProviderError } from './types.js'

export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined
    || status === 408
    || status === 409
    || status === 429
    || status === 529
    || status >= 500
}

/** 供应商类型 → maheshvara 线制标识（错误体解析的分支依据）。custom 由调用方回退通用信封。 */
export function providerWireFormat(type: ProviderConfig['type']): string {
  switch (type) {
    case 'chat-completions':
      return FORMAT_OPENAI_CHAT
    case 'responses':
      return FORMAT_RESPONSES
    case 'gemini':
      return FORMAT_GEMINI
    case 'anthropic':
      return FORMAT_CLAUDE
    default:
      return FORMAT_OPENAI_CHAT
  }
}

/**
 * class 驱动的重试判定（对齐 Go error_protocol 的意图）：
 * - rate_limit / overloaded / upstream / server 可重试
 * - authentication / permission / model_not_found 不可（配置类，重试必再败）
 * - invalid_request 默认不可重试——5xx 状态但错误体是配置类时降级，
 *   防止 SDK/网关重试风暴；仅超时（408）/冲突（409）/无状态码维持历史可重试
 * 无 class 时回退纯状态码判定（现状行为）。
 */
export function providerErrorRetryable(status: number | undefined, errClass: string | undefined): boolean {
  if (!errClass) return isRetryableStatus(status)
  switch (errClass) {
    case ERROR_CLASS_RATE_LIMIT:
    case ERROR_CLASS_OVERLOADED:
    case ERROR_CLASS_UPSTREAM:
    case ERROR_CLASS_SERVER:
      return true
    case ERROR_CLASS_AUTHENTICATION:
    case ERROR_CLASS_PERMISSION:
    case ERROR_CLASS_MODEL_NOT_FOUND:
      return false
    case ERROR_CLASS_INVALID_REQUEST:
    default:
      return status === undefined || status === 408 || status === 409
  }
}

/** 过滤 parseUpstreamError 的兜底摘要（未解析出真实 message 时回退旧文案）。 */
function upstreamParsedMessage(message: string): string | undefined {
  if (message === '' || message === 'upstream request failed') return undefined
  if (message.startsWith('upstream error: ')) return undefined
  return message
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

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
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
  }

  // P2-8：超时保护延伸到 body 读取。此前响应头到达后即拆定时器，res.json()
  // 挂死时无限等待——provider 阻塞会卡死同 habitat 串行队列。包装 json/text：
  // abort 中断 body 流 → timeout（可重试）；body 截断解析失败 → invalid-response
  // （不可重试，P2-10 配套）；读取完成（无论成败）后才清除定时器。
  let timerSettled = false
  const settleTimer = () => {
    if (!timerSettled) {
      timerSettled = true
      clearTimeout(timer)
    }
  }
  // 防御：mock Response 可能缺方法（逐个存在才包装）
  const originalJson = typeof response.json === 'function' ? response.json.bind(response) : undefined
  const originalText = typeof response.text === 'function' ? response.text.bind(response) : undefined
  response.json = originalJson === undefined ? response.json : async (): Promise<unknown> => {
    try {
      return await originalJson()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError(
          `Provider "${providerId}" body read timed out after ${timeoutMs}ms`,
          providerId,
          undefined,
          undefined,
          { retryable: true, code: 'timeout', cause: error },
        )
      }
      throw new ProviderError(
        `Provider "${providerId}" returned an unparseable response body: ${error instanceof Error ? error.message : String(error)}`,
        providerId,
        undefined,
        undefined,
        { retryable: false, code: 'invalid-response', cause: error },
      )
    } finally {
      settleTimer()
    }
  }
  response.text = originalText === undefined ? response.text : async (): Promise<string> => {
    try {
      return await originalText()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError(
          `Provider "${providerId}" body read timed out after ${timeoutMs}ms`,
          providerId,
          undefined,
          undefined,
          { retryable: true, code: 'timeout', cause: error },
        )
      }
      throw error
    } finally {
      settleTimer()
    }
  }
  return response
}

export function createHttpProviderError(
  providerName: string,
  providerId: string,
  res: Response,
  responseBody: unknown,
  format?: string,
): ProviderError {
  let errClass: string | undefined
  let retryable = isRetryableStatus(res.status)
  let message: string | undefined
  if (format) {
    // 按上游线制解析错误体：真实 message + 稳定分类（Go ParseUpstreamError 契约）。
    const parsed = parseUpstreamError(format, res.status, responseBody)
    errClass = parsed.class
    retryable = providerErrorRetryable(res.status, parsed.class)
    const upstreamMessage = upstreamParsedMessage(parsed.message)
    if (upstreamMessage !== undefined) {
      message = `${providerName} API failed (${res.status} ${errClass}): ${upstreamMessage}`
    }
  }
  return new ProviderError(
    message ?? `${providerName} API failed: ${res.status} ${res.statusText}`,
    providerId,
    res.status,
    responseBody,
    {
      retryable,
      code: `http-${res.status}`,
      class: errClass,
    },
  )
}

export function createProviderApiError(
  providerName: string,
  providerId: string,
  responseBody: unknown,
  statusCode?: number,
  format?: string,
): ProviderError {
  let errClass: string | undefined
  let retryable = isRetryableStatus(statusCode)
  let message = extractErrorMessage(responseBody)
  if (format) {
    const parsed = parseUpstreamError(format, statusCode ?? 0, responseBody)
    errClass = parsed.class
    retryable = providerErrorRetryable(statusCode, parsed.class)
    const upstreamMessage = upstreamParsedMessage(parsed.message)
    if (upstreamMessage !== undefined) message = `${providerName} API error (${errClass}): ${upstreamMessage}`
  }
  return new ProviderError(
    message,
    providerId,
    statusCode,
    responseBody,
    {
      retryable,
      code: statusCode ? `http-${statusCode}` : 'api-error',
      class: errClass,
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

/**
 * Responses API 的 status 是响应生命周期状态（completed/in_progress/failed/
 * incomplete），不是停止原因；截断/过滤检测必须看 incomplete_details.reason
 * 才能映射到统一词表（P1-11）。
 */
export function normalizeResponsesFinishReason(status: unknown, incompleteReason?: unknown): string {
  if (status === 'incomplete') {
    if (incompleteReason === 'content_filter') return 'content_filter'
    if (incompleteReason === 'max_output_tokens') return 'length'
    return 'unknown'
  }
  if (status === 'completed') return 'stop'
  return 'unknown'
}
