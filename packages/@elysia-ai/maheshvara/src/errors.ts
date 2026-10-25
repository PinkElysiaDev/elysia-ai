/**
 * 错误的核心协议转换（Maheshvara 化）。
 * 与 Elysia-Api（Go）`backend/relay/error_protocol.go` 逐函数对齐。
 *
 * 请求/响应体经 Maheshvara 互转，错误同样需要：失败点产出统一的
 * MaheshvaraError，出口按客户端线制渲染成各自协议的标准错误体。
 * 现行规范依据（2026-09 核验）：
 *   - OpenAI（Chat/Responses 共用信封，四字段 required、param/code 可 null）：
 *     401 = invalid_request_error + code "invalid_api_key"；429 = rate_limit_error
 *     （+细分 code）；503 = service_unavailable_error + "server_is_overloaded"；
 *     模型不存在 = 404 + code "model_not_found" + param "model"。旧 type 枚举
 *     （authentication_error 等）已废弃，细分一律走 code。
 *   - Anthropic：{"type":"error","error":{"type","message"}}，type 取
 *     invalid_request_error/authentication_error/permission_error/
 *     not_found_error/rate_limit_error/api_error/overloaded_error(529)。
 *   - Gemini：{"error":{"code":<HTTP>,"message","status"}}，status 取 gRPC 码
 *     INVALID_ARGUMENT/UNAUTHENTICATED/PERMISSION_DENIED/NOT_FOUND/
 *     RESOURCE_EXHAUSTED/UNAVAILABLE/INTERNAL。
 * SDK/Codex 对 ≥500 自动重试：配置类错误必须归 4xx，否则触发客户端重试风暴。
 */

import type { MaheshvaraError } from './maheshvara.js'
import { asRecord, stringValue } from './accessors.js'
import { FORMAT_CLAUDE, FORMAT_GEMINI, FORMAT_OPENAI, FORMAT_OPENAI_CHAT, FORMAT_RESPONSES } from './constants.js'

/**
 * ErrorClass 是错误的稳定分类：四线制的 type/status/code 均由它派生，
 * 细分码（如上游 429 的 slow_down）负载在 MaheshvaraError.code 上原样透传。
 * 与 usage 记录的 errorKind 同值域。
 */
export const ERROR_CLASS_INVALID_REQUEST = 'invalid_request'
export const ERROR_CLASS_AUTHENTICATION = 'authentication'
export const ERROR_CLASS_PERMISSION = 'permission'
export const ERROR_CLASS_MODEL_NOT_FOUND = 'model_not_found'
export const ERROR_CLASS_RATE_LIMIT = 'rate_limit'
export const ERROR_CLASS_OVERLOADED = 'overloaded'
export const ERROR_CLASS_UPSTREAM = 'upstream'
export const ERROR_CLASS_SERVER = 'server'

export type ErrorClass =
  | typeof ERROR_CLASS_INVALID_REQUEST
  | typeof ERROR_CLASS_AUTHENTICATION
  | typeof ERROR_CLASS_PERMISSION
  | typeof ERROR_CLASS_MODEL_NOT_FOUND
  | typeof ERROR_CLASS_RATE_LIMIT
  | typeof ERROR_CLASS_OVERLOADED
  | typeof ERROR_CLASS_UPSTREAM
  | typeof ERROR_CLASS_SERVER

/**
 * 该分类的建议 HTTP 状态码（Go ErrorClass.HTTPStatus）。
 * 客户端不可重试的配置类问题全部 4xx。
 */
export function errorClassHTTPStatus(value: string): number {
  switch (value) {
    case ERROR_CLASS_INVALID_REQUEST:
      return 400
    case ERROR_CLASS_AUTHENTICATION:
      return 401
    case ERROR_CLASS_PERMISSION:
      return 403
    case ERROR_CLASS_MODEL_NOT_FOUND:
      return 404
    case ERROR_CLASS_RATE_LIMIT:
      return 429
    case ERROR_CLASS_OVERLOADED:
      return 503
    case ERROR_CLASS_UPSTREAM:
      return 502
    default:
      return 500
  }
}

/** 补全空分类：未分类的错误按服务端内部错误处理（Go OrDefault）。 */
export function errorClassOrDefault(value: string | undefined): string {
  if (value === undefined || value === '') return ERROR_CLASS_SERVER
  return value
}

/**
 * OpenAI 信封的 type 与建议 code（细分 code 由 err.code 覆盖）
 * （Go ErrorClass.openAITypeCode）。
 */
export function openAIErrorTypeCode(value: string): { type: string; code: string } {
  switch (value) {
    case ERROR_CLASS_INVALID_REQUEST:
      return { type: 'invalid_request_error', code: '' }
    case ERROR_CLASS_AUTHENTICATION:
      // 现行实践：401 的 type 也是 invalid_request_error，细分靠 code。
      return { type: 'invalid_request_error', code: 'invalid_api_key' }
    case ERROR_CLASS_PERMISSION:
      return { type: 'invalid_request_error', code: '' }
    case ERROR_CLASS_MODEL_NOT_FOUND:
      return { type: 'invalid_request_error', code: 'model_not_found' }
    case ERROR_CLASS_RATE_LIMIT:
      return { type: 'rate_limit_error', code: '' }
    case ERROR_CLASS_OVERLOADED:
      return { type: 'service_unavailable_error', code: 'server_is_overloaded' }
    case ERROR_CLASS_UPSTREAM:
      return { type: 'api_error', code: '' }
    default:
      return { type: 'api_error', code: 'server_error' }
  }
}

/** Anthropic 信封的 type（Go ErrorClass.anthropicType）。 */
export function anthropicErrorType(value: string): string {
  switch (value) {
    case ERROR_CLASS_INVALID_REQUEST:
      return 'invalid_request_error'
    case ERROR_CLASS_AUTHENTICATION:
      return 'authentication_error'
    case ERROR_CLASS_PERMISSION:
      return 'permission_error'
    case ERROR_CLASS_MODEL_NOT_FOUND:
      return 'not_found_error'
    case ERROR_CLASS_RATE_LIMIT:
      return 'rate_limit_error'
    case ERROR_CLASS_OVERLOADED:
      return 'overloaded_error'
    default:
      return 'api_error'
  }
}

/** Gemini 信封的 gRPC status 码（Go ErrorClass.geminiStatus）。 */
export function geminiErrorStatus(value: string): string {
  switch (value) {
    case ERROR_CLASS_INVALID_REQUEST:
      return 'INVALID_ARGUMENT'
    case ERROR_CLASS_AUTHENTICATION:
      return 'UNAUTHENTICATED'
    case ERROR_CLASS_PERMISSION:
      return 'PERMISSION_DENIED'
    case ERROR_CLASS_MODEL_NOT_FOUND:
      return 'NOT_FOUND'
    case ERROR_CLASS_RATE_LIMIT:
      return 'RESOURCE_EXHAUSTED'
    case ERROR_CLASS_OVERLOADED:
    case ERROR_CLASS_UPSTREAM:
      return 'UNAVAILABLE'
    default:
      return 'INTERNAL'
  }
}

/**
 * 结合上游真实状态码（若有）给出最终 HTTP 状态（Go EffectiveStatus）：
 * 上游状态优先（保真），缺失时按分类推导。
 */
export function effectiveErrorStatus(err: MaheshvaraError): number {
  if ((err.status ?? 0) > 0) return err.status!
  return errorClassHTTPStatus(errorClassOrDefault(err.class))
}

/**
 * 把核心错误渲染为客户端线制的标准错误体（Go ProtocolErrorBody）。
 * format 为客户端输入协议；返回最终 HTTP 状态码与 JSON 体对象。
 */
export function protocolErrorBody(format: string, err: MaheshvaraError): { status: number; body: Record<string, unknown> } {
  const class_ = errorClassOrDefault(err.class)
  let status = effectiveErrorStatus(err)
  switch (format) {
    case FORMAT_CLAUDE: {
      // Anthropic 的过载分类固定 529；其余沿用分类状态码。
      if (class_ === ERROR_CLASS_OVERLOADED && (err.status ?? 0) === 0) {
        status = 529
      }
      return {
        status,
        body: {
          type: 'error',
          error: {
            type: anthropicErrorType(class_),
            message: err.message,
          },
        },
      }
    }
    case FORMAT_GEMINI: {
      return {
        status,
        body: {
          error: {
            code: status,
            message: err.message,
            status: geminiErrorStatus(class_),
          },
        },
      }
    }
    default: {
      // OpenAI Chat / Responses 共用信封，四字段 required（param/code 可 null）。
      const { type, code } = openAIErrorTypeCode(class_)
      const finalCode = err.code !== '' && err.code !== undefined ? err.code : code
      let param: string | null = null
      if (err.param) {
        param = err.param
      } else if (class_ === ERROR_CLASS_MODEL_NOT_FOUND) {
        param = 'model'
      }
      return {
        status,
        body: {
          error: {
            message: err.message,
            type,
            param,
            code: finalCode === '' ? null : finalCode,
          },
        },
      }
    }
  }
}

/** 按 OpenAI error.type 反推分类（流式 error 事件与 response.failed 的 type 值与 HTTP type 同源）。 */
export function classFromOpenAIType(value: string): string {
  switch (value) {
    case 'invalid_request_error':
      return ERROR_CLASS_INVALID_REQUEST
    case 'rate_limit_error':
    case 'insufficient_quota':
      return ERROR_CLASS_RATE_LIMIT
    case 'service_unavailable_error':
      return ERROR_CLASS_OVERLOADED
    case 'api_error':
      return ERROR_CLASS_UPSTREAM
    case 'server_error':
      return ERROR_CLASS_SERVER
    case 'content_filter':
      return ERROR_CLASS_INVALID_REQUEST
    case '':
      return ''
    default:
      return ERROR_CLASS_UPSTREAM
  }
}

/** 按 Anthropic error.type 反推分类。 */
export function classFromAnthropicType(value: string): string {
  switch (value) {
    case 'invalid_request_error':
      return ERROR_CLASS_INVALID_REQUEST
    case 'authentication_error':
      return ERROR_CLASS_AUTHENTICATION
    case 'permission_error':
      return ERROR_CLASS_PERMISSION
    case 'not_found_error':
      return ERROR_CLASS_MODEL_NOT_FOUND
    case 'rate_limit_error':
      return ERROR_CLASS_RATE_LIMIT
    case 'overloaded_error':
      return ERROR_CLASS_OVERLOADED
    default:
      return ERROR_CLASS_UPSTREAM
  }
}

/** 按 Gemini error.status（gRPC 码）反推分类。 */
export function classFromGeminiStatus(value: string): string {
  switch (value) {
    case 'INVALID_ARGUMENT':
    case 'FAILED_PRECONDITION':
      return ERROR_CLASS_INVALID_REQUEST
    case 'UNAUTHENTICATED':
      return ERROR_CLASS_AUTHENTICATION
    case 'PERMISSION_DENIED':
      return ERROR_CLASS_PERMISSION
    case 'NOT_FOUND':
      return ERROR_CLASS_MODEL_NOT_FOUND
    case 'RESOURCE_EXHAUSTED':
      return ERROR_CLASS_RATE_LIMIT
    case 'UNAVAILABLE':
      return ERROR_CLASS_OVERLOADED
    default:
      return ERROR_CLASS_UPSTREAM
  }
}

/** 按上游 HTTP 状态反推错误分类（解析出体字段前的兜底）（Go classFromStatus）。 */
export function classFromStatus(status: number): string {
  if (status === 400 || status === 413 || status === 422) return ERROR_CLASS_INVALID_REQUEST
  if (status === 401) return ERROR_CLASS_AUTHENTICATION
  if (status === 403) return ERROR_CLASS_PERMISSION
  if (status === 404) return ERROR_CLASS_MODEL_NOT_FOUND
  if (status === 429) return ERROR_CLASS_RATE_LIMIT
  if (status === 503) return ERROR_CLASS_OVERLOADED
  if (status >= 500) return ERROR_CLASS_UPSTREAM
  return ERROR_CLASS_INVALID_REQUEST
}

function openAIErrorFamily(format: string): boolean {
  return format === FORMAT_OPENAI || format === FORMAT_OPENAI_CHAT || format === FORMAT_RESPONSES
}

/**
 * 判断上游错误体与客户端线制是否共用同一错误信封（可原样透传）
 * （Go SameErrorEnvelope）：OpenAI Chat/Responses 共享
 * {error:{message,type,param,code}}；Claude/Gemini 各自匹配。
 */
export function sameErrorEnvelope(upstream: string, client: string): boolean {
  if (openAIErrorFamily(upstream) && openAIErrorFamily(client)) return true
  return upstream === client
}

/** 生成上游原文摘要（解析失败时的兜底消息），截断到 240 字符（Go upstreamErrorSummary）。 */
export function upstreamErrorSummary(body: unknown): string {
  const max = 240
  let text = ''
  if (typeof body === 'string') {
    text = body
  } else if (body !== undefined && body !== null) {
    try {
      text = JSON.stringify(body)
    } catch {
      text = String(body)
    }
  }
  text = text.trim()
  if (text.length > max) text = text.slice(0, max) + '…'
  if (text === '') return 'upstream request failed'
  return 'upstream error: ' + text
}

/**
 * 尽力把上游错误体解析为核心错误（跨线制翻译时使用）（Go ParseUpstreamError）：
 * 按上游线制解出 message/type/code 等字段并归入稳定分类，保留上游真实
 * 状态码与细分 code。解析失败回退按状态码分类 + 原文摘要（截断）。
 * body 接受已解析对象或原始文本。
 */
export function parseUpstreamError(upstreamFormat: string, status: number, body: unknown): MaheshvaraError {
  const err: MaheshvaraError = { message: '', status }
  let raw: Record<string, unknown> | undefined
  if (typeof body === 'string') {
    try {
      raw = asRecord(JSON.parse(body))
    } catch {
      raw = undefined
    }
  } else {
    raw = asRecord(body)
  }
  if (raw) {
    switch (upstreamFormat) {
      case FORMAT_CLAUDE: {
        const inner = asRecord(raw['error'])
        if (inner) {
          err.message = stringValue(inner['message'])
          const t = stringValue(inner['type'])
          if (t !== '') err.class = classFromAnthropicType(t)
        }
        break
      }
      case FORMAT_GEMINI: {
        const inner = asRecord(raw['error'])
        if (inner) {
          err.message = stringValue(inner['message'])
          const s = stringValue(inner['status'])
          if (s !== '') err.class = classFromGeminiStatus(s)
        }
        break
      }
      default: {
        // OpenAI Chat/Responses：{"error":{message,type,param,code}}。
        const inner = asRecord(raw['error'])
        if (inner) {
          err.message = stringValue(inner['message'])
          err.code = stringValue(inner['code'])
          err.param = stringValue(inner['param'])
        }
        break
      }
    }
  }
  if (!err.class) err.class = classFromStatus(status)
  if (err.message === '') err.message = upstreamErrorSummary(body)
  return err
}

/** 上游（非流式）响应体的读取上限：防止异常上游用超大响应体打爆内存（Go MaxUpstreamBodyBytes）。 */
export const MAX_UPSTREAM_BODY_BYTES = 64 << 20
