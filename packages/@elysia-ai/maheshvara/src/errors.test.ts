/**
 * 错误协议层测试：对齐 Go error_protocol.go 的行为契约。
 * 覆盖：分类↔HTTP 状态↔三线渲染、四线错误体解析、空体兜底摘要、
 * 信封家族判定、状态码反推。
 */

import { describe, expect, it } from 'vitest'
import {
  ERROR_CLASS_AUTHENTICATION,
  ERROR_CLASS_INVALID_REQUEST,
  ERROR_CLASS_MODEL_NOT_FOUND,
  ERROR_CLASS_OVERLOADED,
  ERROR_CLASS_RATE_LIMIT,
  ERROR_CLASS_SERVER,
  ERROR_CLASS_UPSTREAM,
  anthropicErrorType,
  classFromAnthropicType,
  classFromGeminiStatus,
  classFromOpenAIType,
  classFromStatus,
  effectiveErrorStatus,
  errorClassHTTPStatus,
  errorClassOrDefault,
  geminiErrorStatus,
  openAIErrorTypeCode,
  parseUpstreamError,
  protocolErrorBody,
  sameErrorEnvelope,
  upstreamErrorSummary,
} from './errors.js'

describe('errorClassHTTPStatus 分类→状态码', () => {
  it('八分类各自映射到固定状态码', () => {
    expect(errorClassHTTPStatus(ERROR_CLASS_INVALID_REQUEST)).toBe(400)
    expect(errorClassHTTPStatus(ERROR_CLASS_AUTHENTICATION)).toBe(401)
    expect(errorClassHTTPStatus('permission')).toBe(403)
    expect(errorClassHTTPStatus(ERROR_CLASS_MODEL_NOT_FOUND)).toBe(404)
    expect(errorClassHTTPStatus(ERROR_CLASS_RATE_LIMIT)).toBe(429)
    expect(errorClassHTTPStatus(ERROR_CLASS_OVERLOADED)).toBe(503)
    expect(errorClassHTTPStatus(ERROR_CLASS_UPSTREAM)).toBe(502)
    expect(errorClassHTTPStatus(ERROR_CLASS_SERVER)).toBe(500)
  })

  it('OrDefault 把空分类补为 server', () => {
    expect(errorClassOrDefault(undefined)).toBe(ERROR_CLASS_SERVER)
    expect(errorClassOrDefault('')).toBe(ERROR_CLASS_SERVER)
    expect(errorClassOrDefault(ERROR_CLASS_RATE_LIMIT)).toBe(ERROR_CLASS_RATE_LIMIT)
  })
})

describe('线制渲染派生', () => {
  it('OpenAI：401 细分走 code，过载为 service_unavailable + server_is_overloaded', () => {
    expect(openAIErrorTypeCode(ERROR_CLASS_AUTHENTICATION)).toEqual({ type: 'invalid_request_error', code: 'invalid_api_key' })
    expect(openAIErrorTypeCode(ERROR_CLASS_OVERLOADED)).toEqual({ type: 'service_unavailable_error', code: 'server_is_overloaded' })
    expect(openAIErrorTypeCode(ERROR_CLASS_MODEL_NOT_FOUND)).toEqual({ type: 'invalid_request_error', code: 'model_not_found' })
    expect(openAIErrorTypeCode(ERROR_CLASS_SERVER)).toEqual({ type: 'api_error', code: 'server_error' })
    expect(openAIErrorTypeCode(ERROR_CLASS_RATE_LIMIT)).toEqual({ type: 'rate_limit_error', code: '' })
  })

  it('Anthropic：过载为 overloaded_error，模型不存在为 not_found_error', () => {
    expect(anthropicErrorType(ERROR_CLASS_OVERLOADED)).toBe('overloaded_error')
    expect(anthropicErrorType(ERROR_CLASS_MODEL_NOT_FOUND)).toBe('not_found_error')
    expect(anthropicErrorType(ERROR_CLASS_AUTHENTICATION)).toBe('authentication_error')
    expect(anthropicErrorType('whatever')).toBe('api_error')
  })

  it('Gemini：限流为 RESOURCE_EXHAUSTED，上游/过载为 UNAVAILABLE', () => {
    expect(geminiErrorStatus(ERROR_CLASS_RATE_LIMIT)).toBe('RESOURCE_EXHAUSTED')
    expect(geminiErrorStatus(ERROR_CLASS_OVERLOADED)).toBe('UNAVAILABLE')
    expect(geminiErrorStatus(ERROR_CLASS_UPSTREAM)).toBe('UNAVAILABLE')
    expect(geminiErrorStatus(ERROR_CLASS_INVALID_REQUEST)).toBe('INVALID_ARGUMENT')
  })
})

describe('effectiveErrorStatus', () => {
  it('上游真实状态优先，缺失按分类推导', () => {
    expect(effectiveErrorStatus({ message: 'x', class: ERROR_CLASS_RATE_LIMIT, status: 503 })).toBe(503)
    expect(effectiveErrorStatus({ message: 'x', class: ERROR_CLASS_RATE_LIMIT })).toBe(429)
    expect(effectiveErrorStatus({ message: 'x' })).toBe(500)
  })
})

describe('protocolErrorBody 三线渲染', () => {
  it('Anthropic：过载且无上游状态时固定 529', () => {
    const { status, body } = protocolErrorBody('claude', { message: 'Overloaded', class: ERROR_CLASS_OVERLOADED })
    expect(status).toBe(529)
    expect(body).toEqual({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })
  })

  it('Anthropic：上游状态存在时保真不过载改写', () => {
    const { status } = protocolErrorBody('claude', { message: 'x', class: ERROR_CLASS_OVERLOADED, status: 500 })
    expect(status).toBe(500)
  })

  it('Gemini：gRPC 状态码信封', () => {
    const { status, body } = protocolErrorBody('gemini', { message: 'bad', class: ERROR_CLASS_INVALID_REQUEST })
    expect(status).toBe(400)
    expect(body).toEqual({
      error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' },
    })
  })

  it('OpenAI：model_not_found 补 param=model；细分 code 覆盖；空值为 null', () => {
    const { status, body } = protocolErrorBody('openai_chat', { message: 'no model', class: ERROR_CLASS_MODEL_NOT_FOUND })
    expect(status).toBe(404)
    expect(body).toEqual({
      error: { message: 'no model', type: 'invalid_request_error', param: 'model', code: 'model_not_found' },
    })

    const overridden = protocolErrorBody('openai', { message: 'slow', class: ERROR_CLASS_RATE_LIMIT, code: 'slow_down' })
    expect((overridden.body['error'] as Record<string, unknown>)['code']).toBe('slow_down')

    const empty = protocolErrorBody('openai_responses', { message: 'bad', class: ERROR_CLASS_INVALID_REQUEST })
    expect(empty.body).toEqual({
      error: { message: 'bad', type: 'invalid_request_error', param: null, code: null },
    })
  })
})

describe('parseUpstreamError 四线解析', () => {
  it('OpenAI：type 反推分类，code/param 原样保留', () => {
    const err = parseUpstreamError('openai_chat', 429, {
      error: { message: 'Rate limited', type: 'rate_limit_error', code: 'slow_down', param: null },
    })
    expect(err.class).toBe(ERROR_CLASS_RATE_LIMIT)
    expect(err.message).toBe('Rate limited')
    expect(err.code).toBe('slow_down')
    expect(err.status).toBe(429)
  })

  it('Anthropic：type 反推分类', () => {
    const err = parseUpstreamError('claude', 529, { error: { type: 'overloaded_error', message: 'busy' } })
    expect(err.class).toBe(ERROR_CLASS_OVERLOADED)
    expect(err.message).toBe('busy')
  })

  it('Gemini：gRPC status 反推分类', () => {
    const err = parseUpstreamError('gemini', 401, { error: { code: 401, message: 'no key', status: 'UNAUTHENTICATED' } })
    expect(err.class).toBe(ERROR_CLASS_AUTHENTICATION)
  })

  it('解析失败：按状态码兜底分类 + 原文摘要', () => {
    const err = parseUpstreamError('openai', 503, '<html>gateway exploded</html>')
    expect(err.class).toBe(ERROR_CLASS_OVERLOADED)
    expect(err.message).toBe('upstream error: <html>gateway exploded</html>')
  })

  it('字符串 JSON 体也走解析路径', () => {
    const err = parseUpstreamError('claude', 400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad shape' } }))
    expect(err.class).toBe(ERROR_CLASS_INVALID_REQUEST)
    expect(err.message).toBe('bad shape')
  })

  it('空体：摘要兜底为 upstream request failed', () => {
    const err = parseUpstreamError('openai', 500, '')
    expect(err.message).toBe('upstream request failed')
    expect(err.class).toBe(ERROR_CLASS_UPSTREAM)
  })
})

describe('classFromX 反推', () => {
  it('classFromOpenAIType：细分与未知值', () => {
    expect(classFromOpenAIType('insufficient_quota')).toBe(ERROR_CLASS_RATE_LIMIT)
    expect(classFromOpenAIType('content_filter')).toBe(ERROR_CLASS_INVALID_REQUEST)
    expect(classFromOpenAIType('weird_new_type')).toBe(ERROR_CLASS_UPSTREAM)
    expect(classFromOpenAIType('server_error')).toBe(ERROR_CLASS_SERVER)
    expect(classFromOpenAIType('')).toBe('')
  })

  it('classFromAnthropicType / classFromGeminiStatus', () => {
    expect(classFromAnthropicType('permission_error')).toBe('permission')
    expect(classFromAnthropicType('unknown')).toBe(ERROR_CLASS_UPSTREAM)
    expect(classFromGeminiStatus('FAILED_PRECONDITION')).toBe(ERROR_CLASS_INVALID_REQUEST)
    expect(classFromGeminiStatus('RESOURCE_EXHAUSTED')).toBe(ERROR_CLASS_RATE_LIMIT)
  })

  it('classFromStatus：413/422 归 invalid_request，529 归 upstream，未知归 invalid_request', () => {
    expect(classFromStatus(413)).toBe(ERROR_CLASS_INVALID_REQUEST)
    expect(classFromStatus(422)).toBe(ERROR_CLASS_INVALID_REQUEST)
    expect(classFromStatus(529)).toBe(ERROR_CLASS_UPSTREAM)
    expect(classFromStatus(418)).toBe(ERROR_CLASS_INVALID_REQUEST)
  })
})

describe('sameErrorEnvelope', () => {
  it('OpenAI 家族互通，跨族不通', () => {
    expect(sameErrorEnvelope('openai', 'openai_responses')).toBe(true)
    expect(sameErrorEnvelope('openai_chat', 'openai')).toBe(true)
    expect(sameErrorEnvelope('claude', 'claude')).toBe(true)
    expect(sameErrorEnvelope('claude', 'openai')).toBe(false)
    expect(sameErrorEnvelope('gemini', 'openai')).toBe(false)
  })
})

describe('upstreamErrorSummary', () => {
  it('超长截断到 240 字符并加省略号；空体固定文案', () => {
    const long = upstreamErrorSummary('x'.repeat(300))
    expect(long.length).toBe('upstream error: '.length + 240 + '…'.length)
    expect(long.endsWith('…')).toBe(true)
    expect(upstreamErrorSummary('')).toBe('upstream request failed')
    expect(upstreamErrorSummary(undefined)).toBe('upstream request failed')
    expect(upstreamErrorSummary({ hello: 'world' })).toBe('upstream error: {"hello":"world"}')
  })
})
