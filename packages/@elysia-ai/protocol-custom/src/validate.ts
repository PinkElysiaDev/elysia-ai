/**
 * 协议配置整体校验：注册前保证可编译、可渲染、路径/操作符/类型合法。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol.go` 的
 * ValidateCustomProtocol 族逐分支对齐。
 */

import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import type {
  CustomProtocolConfig,
  CustomProtocolMatch,
  CustomProtocolRequest,
  CustomProtocolResponse,
  CustomProtocolStreamFrame,
  CustomProtocolStreamTool,
} from './types.js'
import { CUSTOM_PROTOCOL_TYPE_EMBEDDING, CUSTOM_PROTOCOL_TYPE_LLM, CUSTOM_PROTOCOL_TYPE_RERANKER } from './types.js'
import { validateCustomProtocolMatch } from './match.js'
import { normalizeMatchSet } from './match.js'
import {
  compileCustomProtocolBody,
  customProtocolResponseHasMapping,
  effectiveCustomProtocolResponse,
  effectiveResponseFieldMappings,
  hasCustomProtocolAnnotationBody,
  validateResponseFieldMappings,
} from './compile.js'
import {
  maheshvaraTemplateContext,
  normalizeMaheshvaraPath,
  renderCustomTemplate,
  validateCustomStringTemplate,
  CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES,
  type CustomOmitRule,
} from './template.js'
import { parseCustomPath } from './paths.js'
import { isSupportedCustomMappingTransform } from './schema.js'
import { validateCustomResponseTarget } from './response.js'

/** 归一化协议类型：空值回落 llm；接受 llm/reranker/embedding 与 x- 前缀。返回空串表示非法值。 */
export function normalizeCustomProtocolType(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === '') return CUSTOM_PROTOCOL_TYPE_LLM
  switch (normalized) {
    case CUSTOM_PROTOCOL_TYPE_LLM:
    case CUSTOM_PROTOCOL_TYPE_RERANKER:
    case CUSTOM_PROTOCOL_TYPE_EMBEDDING:
      return normalized
  }
  if (normalized.startsWith('x-') && normalized.trim().length > 2) return normalized
  return ''
}

/**
 * 返回生效的请求体模板与 omitIfEmpty 路径：字段引用树（新模型）编译为模板
 * 并自动收集 omit 路径；否则维持 legacy 行为。
 */
export function effectiveCustomProtocolBodyTemplate(
  request: CustomProtocolRequest,
): { template: string; omitIfEmpty: string[]; omitRules: CustomOmitRule[] } {
  if (!hasCustomProtocolAnnotationBody(request.body)) {
    // legacy：body 树（无字段引用）或 bodyTemplate/submitBody 原样作为模板文本。
    const raw = request.body !== undefined && request.body !== null ? JSON.stringify(request.body) : ''
    const template = (request.bodyTemplate ?? '').trim() !== ''
      ? request.bodyTemplate!
      : (request.submitBody ?? '').trim() !== '' ? request.submitBody! : raw
    return { template, omitIfEmpty: request.omitIfEmpty ?? [], omitRules: [] }
  }
  const compiled = compileCustomProtocolBody(request.body)
  return {
    template: compiled.template,
    omitIfEmpty: [...(request.omitIfEmpty ?? []), ...compiled.omitIfEmpty],
    omitRules: compiled.omitRules,
  }
}

// 保护头清单：请求/模型发现两处的 headers 共用。
const PROTECTED_CUSTOM_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'proxy-authorization',
])

function isValidCustomHeaderName(name: string): boolean {
  if (name.trim() === '') return false
  for (const char of name) {
    if (/[A-Za-z0-9]/.test(char)) continue
    if (!'!#$%&\'*+-.^_`|~'.includes(char)) return false
  }
  return true
}

function isProtectedCustomHeader(name: string): boolean {
  return PROTECTED_CUSTOM_HEADERS.has(name.trim().toLowerCase())
}

function isUnsafeCustomAuthHeader(name: string): boolean {
  switch (name.trim().toLowerCase()) {
    case 'host':
    case 'content-length':
    case 'transfer-encoding':
    case 'connection':
    case 'proxy-authorization':
      return true
    default:
      return false
  }
}

function validateCustomAuth(location: string, auth: { mode?: string; header?: string; prefix?: string; query?: string }): void {
  let mode = (auth.mode ?? '').trim().toLowerCase()
  if (mode === '') mode = 'bearer'
  switch (mode) {
    case 'bearer':
    case 'none':
      return
    case 'header': {
      const header = (auth.header ?? '').trim() !== '' ? auth.header!.trim() : 'x-api-key'
      if (!isValidCustomHeaderName(header) || isUnsafeCustomAuthHeader(header)) {
        throw new Error(`${location}: header auth requires a valid end-to-end header name`)
      }
      if ((auth.prefix ?? '').includes('\r') || (auth.prefix ?? '').includes('\n')) {
        throw new Error(`${location}: auth prefix contains a line break`)
      }
      return
    }
    case 'query': {
      if ((auth.query ?? '').trim() === '') {
        throw new Error(`${location}: query auth requires query`)
      }
      if ((auth.query ?? '').includes('\r') || (auth.query ?? '').includes('\n')) {
        throw new Error(`${location}: auth query contains a line break`)
      }
      return
    }
    default:
      throw new Error(`${location}: unsupported auth mode ${JSON.stringify(auth.mode)}`)
  }
}

function validateCustomHeaders(configID: string, location: string, headers: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(headers ?? {})) {
    try {
      validateCustomStringTemplate(value)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}[${JSON.stringify(key)}]: ${(error as Error).message}`)
    }
  }
  for (const [key, value] of Object.entries(headers ?? {})) {
    const name = key.trim()
    if (name === '') {
      throw new Error(`custom protocol ${JSON.stringify(configID)} contains an empty header name`)
    }
    if (!isValidCustomHeaderName(name)) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} contains invalid header name ${JSON.stringify(key)}`)
    }
    if (isProtectedCustomHeader(name)) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} header ${JSON.stringify(key)} is managed by the relay; use auth`)
    }
    if (value.includes('\r') || value.includes('\n')) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} header ${JSON.stringify(key)} contains a line break`)
    }
  }
}

function validateCustomProtocolModels(configID: string, models: CustomProtocolConfig['models']): void {
  if (!models) return
  if ((models.path ?? '').trim() === '') {
    throw new Error(`custom protocol ${JSON.stringify(configID)} models.path is required`)
  }
  try {
    validateCustomStringTemplate(models.path)
  } catch (error) {
    throw new Error(`custom protocol ${JSON.stringify(configID)} models.path: ${(error as Error).message}`)
  }
  const method = (models.method ?? '').trim().toUpperCase()
  switch (method) {
    case '':
    case 'GET':
    case 'POST':
      break
    default:
      throw new Error(`custom protocol ${JSON.stringify(configID)} models method ${JSON.stringify(models.method)} is unsupported (GET or POST)`)
  }
  validateCustomHeaders(configID, 'models.headers', models.headers)
  for (const [key, value] of Object.entries(models.query ?? {})) {
    try {
      validateCustomStringTemplate(value)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} models.query[${JSON.stringify(key)}]: ${(error as Error).message}`)
    }
  }
  if (models.auth) validateCustomAuth(`custom protocol ${JSON.stringify(configID)} models.auth`, models.auth)
  if ((models.listPath ?? '').trim() === '') {
    throw new Error(`custom protocol ${JSON.stringify(configID)} models.listPath is required`)
  }
  try {
    parseCustomPath(models.listPath!)
  } catch (error) {
    throw new Error(`custom protocol ${JSON.stringify(configID)} models.listPath: ${(error as Error).message}`)
  }
  for (const [field, value] of [['models.idPath', models.idPath], ['models.namePath', models.namePath]] as const) {
    if ((value ?? '').trim() === '') continue
    try {
      parseCustomPath(value!)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${field}: ${(error as Error).message}`)
    }
  }
}

function validateCustomProtocolAliases(configID: string, aliases: CustomProtocolConfig['aliases']): void {
  if (!aliases) return
  for (const key of aliases.textKeys ?? []) {
    if (key.trim() === '' || /[\.\[\]{}\r\n]/.test(key)) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.textKeys entry ${JSON.stringify(key)} must be a plain key`)
    }
  }
  const usageCategories = new Set(['input', 'output', 'total', 'cached', 'reasoning'])
  for (const [category, keys] of Object.entries(aliases.usage ?? {})) {
    if (!usageCategories.has(category)) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.usage has unknown category ${JSON.stringify(category)} (allowed: input, output, total, cached, reasoning)`)
    }
    if (!keys || keys.length === 0) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.usage.${category} is empty`)
    }
    for (const key of keys) {
      try {
        parseCustomPath(key)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.usage.${category} entry ${JSON.stringify(key)}: ${(error as Error).message}`)
      }
    }
  }
  const toolCategories = new Set(['id', 'name', 'arguments'])
  for (const [category, keys] of Object.entries(aliases.toolCall ?? {})) {
    if (!toolCategories.has(category)) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.toolCall has unknown category ${JSON.stringify(category)} (allowed: id, name, arguments)`)
    }
    if (!keys || keys.length === 0) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.toolCall.${category} is empty`)
    }
    for (const key of keys) {
      try {
        parseCustomPath(key)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)} aliases.toolCall.${category} entry ${JSON.stringify(key)}: ${(error as Error).message}`)
      }
    }
  }
}

function validateCustomProtocolStreamTool(configID: string, location: string, tool: CustomProtocolStreamTool): void {
  const paths: Record<string, string | undefined> = {
    path: tool.path,
    idPath: tool.idPath,
    indexPath: tool.indexPath,
    namePath: tool.namePath,
    argumentsPath: tool.argumentsPath,
  }
  let declared = 0
  for (const [field, value] of Object.entries(paths)) {
    if ((value ?? '').trim() === '') continue
    declared++
    try {
      parseCustomPath(value!)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.${field}: ${(error as Error).message}`)
    }
  }
  if (declared === 0) {
    throw new Error(`custom protocol ${JSON.stringify(configID)} ${location} requires at least one of idPath, indexPath, namePath, argumentsPath`)
  }
  const mode = (tool.argumentsMode ?? '').trim().toLowerCase()
  if (mode !== '' && mode !== 'delta' && mode !== 'cumulative') {
    throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.argumentsMode ${JSON.stringify(tool.argumentsMode)} is unsupported`)
  }
}

function validateStreamFrames(configID: string, location: string, frames: CustomProtocolStreamFrame[] | undefined): void {
  (frames ?? []).forEach((frame, index) => {
    if ((frame.event ?? '').trim() === '' && !frame.match) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.frames[${index}] requires event or match`)
    }
    if ((frame.event ?? '').includes('\r') || (frame.event ?? '').includes('\n')) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.frames[${index}].event contains a line break`)
    }
    if (frame.match) {
      try {
        validateCustomProtocolMatch(`${location}.stream.frames[${index}].match`, frame.match)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)}: ${(error as Error).message}`)
      }
    }
    if (frame.tool) {
      validateCustomProtocolStreamTool(configID, `${location}.stream.frames[${index}].tool`, frame.tool)
    }
    const payloadPath = (frame.payloadPath ?? '').trim()
    if (payloadPath !== '') {
      try {
        parseCustomPath(payloadPath)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.frames[${index}].payloadPath: ${(error as Error).message}`)
      }
    }
    if (frame.response) {
      validateCustomProtocolResponse(configID, `${location}.stream.frames[${index}].response`, frame.response, false)
    }
  })
}

function validateCustomProtocolResponse(
  configID: string,
  location: string,
  rawResponse: CustomProtocolResponse,
  allowStream: boolean,
): void {
  const response = effectiveCustomProtocolResponse(location, rawResponse)
  const paths: Record<string, string | undefined> = {
    idPath: response.idPath,
    modelPath: response.modelPath,
    statusPath: response.statusPath,
    textPath: response.textPath,
    reasoningPath: response.reasoningPath,
    toolCallsPath: response.toolCallsPath,
    usagePath: response.usagePath,
    finishReasonPath: response.finishReasonPath,
    errorPath: response.errorPath,
  }
  for (const [field, path] of Object.entries(paths)) {
    if ((path ?? '').trim() === '') continue
    try {
      parseCustomPath(path!)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.${field}: ${(error as Error).message}`)
    }
  }
  const filters: Array<[string, import('./types.js').CustomProtocolMatchSet | undefined]> = [
    ['textFilter', response.textFilter],
    ['reasoningFilter', response.reasoningFilter],
  ]
  for (const [name, set] of filters) {
    normalizeMatchSet(set).forEach((match, index) => {
      try {
        validateCustomProtocolMatch(`${location}.${name}[${index}]`, match)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)}: ${(error as Error).message}`)
      }
    })
  }
  for (const [key, path] of Object.entries(response.mappings ?? {})) {
    if ((path ?? '').trim() === '') continue
    try {
      parseCustomPath(path)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.mappings[${JSON.stringify(key)}]: ${(error as Error).message}`)
    }
  }
  ;(response.fieldMappings ?? []).forEach((mapping, index) => {
    const target = (mapping.target ?? '').trim().replace(/^maheshvara\./, '')
    try {
      validateCustomResponseTarget(target)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.fieldMappings[${index}]: ${(error as Error).message}`)
    }
    const source = (mapping.source ?? '').trim()
    if (source !== '') {
      try {
        parseCustomPath(source)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.fieldMappings[${index}].source: ${(error as Error).message}`)
      }
    }
    if (source === '' && mapping.value === undefined && mapping.default === undefined) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.fieldMappings[${index}] requires source, value, or default`)
    }
    if (!isSupportedCustomMappingTransform(mapping.transform ?? '')) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.fieldMappings[${index}] uses unsupported transform ${JSON.stringify(mapping.transform)}`)
    }
  })

  const stream = response.stream
  if (!stream) return
  if (!allowStream) {
    throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream cannot contain another stream mapping`)
  }
  const mode = (stream.mode ?? '').trim().toLowerCase()
  if (mode !== '' && mode !== 'delta' && mode !== 'cumulative') {
    throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream mode ${JSON.stringify(stream.mode)} is unsupported`)
  }
  if (stream.modes) {
    const families: Record<string, string | undefined> = {
      text: stream.modes.text,
      reasoning: stream.modes.reasoning,
      arguments: stream.modes.arguments,
    }
    for (const [family, familyMode] of Object.entries(families)) {
      const normalized = (familyMode ?? '').trim().toLowerCase()
      if (normalized === '' || normalized === 'delta' || normalized === 'cumulative') continue
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.modes.${family} ${JSON.stringify(familyMode)} is unsupported`)
    }
  }
  const payloadPath = (stream.payloadPath ?? '').trim()
  if (payloadPath !== '') {
    try {
      parseCustomPath(payloadPath)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.payloadPath: ${(error as Error).message}`)
    }
  }
  for (const eventName of stream.events ?? []) {
    if (eventName.includes('\r') || eventName.includes('\n')) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream event contains a line break`)
    }
  }
  for (const key of stream.eventKeys ?? []) {
    if (key.includes('\r') || key.includes('\n') || key.trim() === '') {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.eventKeys entry is empty or contains a line break`)
    }
  }
  for (const [name, when] of [['finishWhen', stream.finishWhen], ['statusWhen', stream.statusWhen]] as const) {
    if (when) {
      try {
        validateCustomProtocolMatch(`${location}.stream.${name}`, when)
      } catch (error) {
        throw new Error(`custom protocol ${JSON.stringify(configID)}: ${(error as Error).message}`)
      }
    }
  }
  ;(stream.done ?? []).forEach((done, index) => {
    const hasRaw = (done.raw ?? '').trim() !== ''
    const hasJSON = done.json !== undefined
    if (hasRaw === hasJSON) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream.done[${index}] requires exactly one of raw or json`)
    }
  })
  for (const doneValue of stream.doneValues ?? []) {
    if (doneValue.includes('\r') || doneValue.includes('\n')) {
      throw new Error(`custom protocol ${JSON.stringify(configID)} ${location}.stream done value contains a line break`)
    }
  }
  validateStreamFrames(configID, location, stream.frames)
  if (stream.response) {
    validateCustomProtocolResponse(configID, `${location}.stream.response`, stream.response, false)
  }
}

/** 校验新模型（字段树 + 返回体构造树 + 响应字段映射），成功即保证可编译。 */
function validateCustomProtocolDeclarative(config: CustomProtocolConfig): void {
  if (hasCustomProtocolAnnotationBody(config.request.body)) {
    try {
      compileCustomProtocolBody(config.request.body)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(config.id)} request.body: ${(error as Error).message}`)
    }
  }
  const merged = effectiveResponseFieldMappings('response', config.response ?? {})
  validateResponseFieldMappings('response', merged)
  if (config.response?.stream?.response) {
    const nested = effectiveResponseFieldMappings('response.stream.response', config.response.stream.response)
    validateResponseFieldMappings('response.stream.response', nested)
  }
}

export function validateCustomProtocol(config: CustomProtocolConfig): void {
  const id = (config.id ?? '').trim()
  if (id === '') throw new Error('custom protocol id is required')
  if (/[\s\/\\\t\r\n]/.test(id)) {
    throw new Error(`custom protocol ${JSON.stringify(id)} has invalid id`)
  }
  if (normalizeCustomProtocolType(config.type) === '') {
    throw new Error(`custom protocol ${JSON.stringify(id)} has invalid type ${JSON.stringify(config.type)} (allowed: llm, reranker, embedding, x-*)`)
  }
  validateCustomProtocolDeclarative(config)

  let method = (config.request.method ?? '').trim().toUpperCase()
  if (method === '') method = 'POST'
  const { template, omitIfEmpty, omitRules } = effectiveCustomProtocolBodyTemplate(config.request)
  if (template.length === 0 && method !== 'GET' && method !== 'DELETE') {
    throw new Error(`custom protocol ${JSON.stringify(id)} request.bodyTemplate is required`)
  }
  if (template.length > CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES) {
    throw new Error(`custom protocol ${JSON.stringify(id)} request template exceeds ${CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES} bytes`)
  }
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      break
    default:
      throw new Error(`custom protocol ${JSON.stringify(id)} uses unsupported method ${JSON.stringify(method)}`)
  }
  if (template !== '') {
    // 校验一（空上下文）：空值嵌 null 后的合法性。
    try {
      renderCustomTemplate(template, maheshvaraTemplateContext({} as MaheshvaraRequest), [], omitRules)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(id)} has invalid body template: ${(error as Error).message}`)
    }
    // 校验二（非空示例值）：空值以字符串嵌入时仍是合法 JSON 字符串，会放过
    // 「引号内占位符+其它文本」的缺陷模板（运行时必炸）。
    const sample: MaheshvaraRequest = {
      model: 'x',
      instructions: 'x',
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    }
    try {
      renderCustomTemplate(template, maheshvaraTemplateContext(sample), [], omitRules)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(id)} body template fails with non-empty sample values (quoted placeholder mixed with literal text?): ${(error as Error).message}`)
    }
  }
  for (const path of omitIfEmpty) {
    try {
      parseCustomPath(normalizeMaheshvaraPath(path))
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(id)} omitIfEmpty path ${JSON.stringify(path)}: ${(error as Error).message}`)
    }
  }
  try {
    validateCustomStringTemplate(config.request.path ?? '')
  } catch (error) {
    throw new Error(`custom protocol ${JSON.stringify(id)} request.path: ${(error as Error).message}`)
  }
  try {
    validateCustomStringTemplate(config.request.pathStream ?? '')
  } catch (error) {
    throw new Error(`custom protocol ${JSON.stringify(id)} request.pathStream: ${(error as Error).message}`)
  }
  switch ((config.request.shape ?? '').trim().toLowerCase()) {
    case '':
    case 'openai-chat':
    case 'anthropic':
    case 'gemini':
    case 'responses':
      break
    default:
      throw new Error(`custom protocol ${JSON.stringify(id)} request.shape ${JSON.stringify(config.request.shape)} is unsupported (allowed: openai-chat, anthropic, gemini, responses)`)
  }
  validateCustomHeaders(id, 'request.headers', config.request.headers)
  for (const [key, value] of Object.entries(config.request.query ?? {})) {
    try {
      validateCustomStringTemplate(value)
    } catch (error) {
      throw new Error(`custom protocol ${JSON.stringify(id)} request.query[${JSON.stringify(key)}]: ${(error as Error).message}`)
    }
  }
  const contentType = (config.request.contentType ?? '').trim()
  if (contentType !== '' && (contentType.includes('\r') || contentType.includes('\n'))) {
    throw new Error(`custom protocol ${JSON.stringify(id)} has invalid content type`)
  }
  if (config.request.auth) {
    validateCustomAuth(`custom protocol ${JSON.stringify(id)} auth`, config.request.auth)
  }
  validateCustomProtocolModels(id, config.models)
  validateCustomProtocolAliases(id, config.aliases)
  validateCustomProtocolResponse(id, 'response', config.response ?? {}, true)
}

/**
 * 入库/注册时净化已知的历史踩坑形态：设计器旧版「流式映射」开关写入的
 * 空嵌套映射会在运行时顶掉顶层映射，加载即改为「继承顶层」。
 */
export function normalizeCustomProtocol(config: CustomProtocolConfig): CustomProtocolConfig {
  const next: CustomProtocolConfig = { ...config, request: { ...config.request }, response: config.response ? { ...config.response } : {} }
  next.type = normalizeCustomProtocolType(config.type)
  const stream = next.response?.stream
  if (stream?.response && !customProtocolResponseHasMapping(stream.response)) {
    next.response!.stream = { ...stream, response: undefined }
  }
  return next
}

export { normalizeMatchSet }
export type { CustomProtocolMatch }
