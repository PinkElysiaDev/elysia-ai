/**
 * 响应映射层：上游载荷 → MaheshvaraResponse。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol.go` 的
 * customProtocolResponseFromRoot / 别名提取族，及 `custom_mapping.go` 的
 * transform 族逐函数对齐。
 */

import type {
  MaheshvaraError,
  MaheshvaraResponse,
  MaheshvaraUsage,
  MaheshvaraOutputItem,
  MaheshvaraToolCall,
} from '@elysia-ai/maheshvara'
import { CONTENT_REASONING, CONTENT_TEXT, interfaceToContentParts } from '@elysia-ai/maheshvara'
import { ERROR_CLASS_UPSTREAM } from '@elysia-ai/maheshvara'
import { newMaheshvaraResponseID } from '@elysia-ai/protocol-openai'
import type {
  CustomProtocolAliases,
  CustomProtocolConfig,
  CustomProtocolFieldMapping,
  CustomProtocolMatchSet,
} from './types.js'
import {
  customEmptyValue,
  customLookupPath,
  customNumberValue,
  customValueString,
  setCustomPath,
} from './paths.js'
import { evalMatchAll, normalizeMatchSet } from './match.js'
import { effectiveCustomProtocolRuntimeMapping } from './compile.js'
import { normalizeMaheshvaraPath } from './template.js'
import { assertCustomPathIndexLimit, parseCustomPath } from './paths.js'

/** 一次性解析完成的运行时映射：payloadPath 为流事件的载荷解包路径（非流式为空）。 */
export interface CustomResolvedMapping {
  payloadPath: string
  mapping: import('./types.js').CustomProtocolResponse
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析运行时生效映射（含 legacy mappings 键合并为直接路径）。 */
export function resolveCustomMapping(config: CustomProtocolConfig, allowStreamEvent: boolean): CustomResolvedMapping {
  const resolved: CustomResolvedMapping = { payloadPath: '', mapping: {} }
  if (allowStreamEvent && config.response?.stream) {
    resolved.payloadPath = (config.response.stream.payloadPath ?? '').trim()
  }
  const mapping = effectiveCustomProtocolRuntimeMapping(config, allowStreamEvent)
  // legacy mappings 键在此合并为直接路径（仅填补空缺）。
  if (mapping.mappings) {
    const legacy = mapping.mappings
    mapping.idPath = mapping.idPath || legacy['id']
    mapping.modelPath = mapping.modelPath || legacy['model']
    mapping.statusPath = mapping.statusPath || legacy['status']
    mapping.textPath = mapping.textPath || legacy['text']
    mapping.reasoningPath = mapping.reasoningPath || legacy['reasoning']
    mapping.toolCallsPath = mapping.toolCallsPath || legacy['tool_calls']
    mapping.usagePath = mapping.usagePath || legacy['usage']
    mapping.finishReasonPath = mapping.finishReasonPath || legacy['finish_reason']
    mapping.errorPath = mapping.errorPath || legacy['error']
  }
  resolved.mapping = mapping
  return resolved
}

function customValueAt(root: unknown, path: string): unknown {
  if ((path ?? '').trim() === '') return undefined
  return customLookupPath(root, path).value
}

function customStringAt(root: unknown, path: string): string {
  return customValueString(customValueAt(root, path))
}

/** 解析某类别的生效键列表：声明了非空覆盖即整体替换默认表。 */
function customAliasKeys(aliases: Record<string, string[]> | undefined, category: string, defaults: string[]): string[] {
  const custom = aliases?.[category]
  if (custom && custom.length > 0) return custom
  return defaults
}

const DEFAULT_TEXT_KEYS = ['text', 'content', 'message', 'value', 'output']

function customEffectiveTextKeys(keys: string[] | undefined): string[] {
  if (keys && keys.length > 0) return keys
  return DEFAULT_TEXT_KEYS
}

/** 按给定魔键提取文本；keys 为空时用内置默认表（可经 aliases.textKeys 整体替换）。 */
export function customTextValueWithKeys(value: unknown, keys?: string[]): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    let out = ''
    for (const item of value) out += customTextValueWithKeys(item, keys)
    return out
  }
  if (isPlainObject(value)) {
    for (const key of customEffectiveTextKeys(keys)) {
      const text = customTextValueWithKeys(value[key], keys)
      if (text !== '') return text
    }
    return JSON.stringify(value)
  }
  return customValueString(value)
}

export function customTextValue(value: unknown): string {
  return customTextValueWithKeys(value)
}

/**
 * 提取文本并可按元素过滤：textPath 指向对象数组时先按 filter（单条件或
 * AND 条件集）过滤元素（如仅保留 type=="text" 的块），再按 keys 提取。
 */
function customTextAtFilter(
  root: unknown,
  path: string,
  keys: string[] | undefined,
  filter: CustomProtocolMatchSet | undefined,
): string {
  let value = customValueAt(root, path)
  const set = normalizeMatchSet(filter)
  if (set.length > 0) {
    if (Array.isArray(value)) {
      value = value.filter((item) => evalMatchAll(item, set))
    }
  }
  return customTextValueWithKeys(value, keys)
}

function customArrayAt(root: unknown, path: string): unknown[] | undefined {
  const value = customValueAt(root, path)
  if (Array.isArray(value)) return value
  if (value !== undefined && value !== null) return [value]
  return undefined
}

/**
 * 按别名表读取工具调用字段；别名条目支持点路径（如 function.arguments）。
 * 类别缺省时用内置默认表。
 */
function customToolCallWithAliases(
  value: unknown,
  index: number,
  aliases: Record<string, string[]> | undefined,
): MaheshvaraToolCall {
  const object = isPlainObject(value) ? value : undefined
  if (!object) return { type: 'function', id: '', name: '', arguments: '{}' }
  const lookupString = (keys: string[]): string => {
    for (const key of keys) {
      const { value: found } = customLookupPath(object, key)
      if (found !== undefined) {
        const text = typeof found === 'string' ? found : ''
        if (text !== '') return text
      }
    }
    return ''
  }
  const id = lookupString(customAliasKeys(aliases, 'id', ['id', 'call_id', 'tool_call_id', 'function.id']))
  const name = lookupString(customAliasKeys(aliases, 'name', ['name', 'function_name', 'function.name']))
  let argumentsValue: unknown
  for (const key of customAliasKeys(aliases, 'arguments', ['arguments', 'args', 'input', 'function.arguments', 'function.args', 'function.input'])) {
    const { value: found } = customLookupPath(object, key)
    if (found !== undefined && found !== null) {
      argumentsValue = found
      break
    }
  }
  let argumentsText: string
  if (typeof argumentsValue === 'string') {
    argumentsText = argumentsValue
    try {
      JSON.parse(argumentsText)
    } catch {
      argumentsText = JSON.stringify(argumentsText)
    }
  } else if (argumentsValue !== undefined && argumentsValue !== null) {
    argumentsText = JSON.stringify(argumentsValue)
  } else {
    argumentsText = '{}'
  }
  return {
    id: id !== '' ? id : `call_${index}`,
    type: 'function',
    name,
    arguments: argumentsText,
  }
}

/**
 * 按别名表读取用量；别名条目支持点路径。合法 JSON 数字可能带小数尾缀/
 * 科学计数（Java/Python 服务常见 187.0 / 1e3）：取整兜底。
 */
function customUsageAtWithAliases(
  root: unknown,
  path: string,
  aliases: Record<string, string[]> | undefined,
): MaheshvaraUsage | undefined {
  const value = customValueAt(root, path)
  if (!isPlainObject(value)) return undefined
  const object = value
  const intPath = (keys: string[]): number => {
    for (const key of keys) {
      const { value: found } = customLookupPath(object, key)
      if (found === undefined || found === null) continue
      const number = customNumberValue(found)
      if (number !== undefined) return Math.trunc(number)
    }
    return 0
  }
  const usage: MaheshvaraUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, source: 'provider_response' }
  usage.input_tokens = intPath(customAliasKeys(aliases, 'input', ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount']))
  usage.output_tokens = intPath(customAliasKeys(aliases, 'output', ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount']))
  usage.total_tokens = intPath(customAliasKeys(aliases, 'total', ['total_tokens', 'totalTokens', 'totalTokenCount']))
  usage.cached_input_tokens = intPath(customAliasKeys(aliases, 'cached', ['cached_input_tokens', 'cachedInputTokens', 'cached_tokens', 'cachedContentTokenCount', 'prompt_tokens_details.cached_tokens', 'input_tokens_details.cached_tokens', 'cache_read_tokens']))
  usage.reasoning_tokens = intPath(customAliasKeys(aliases, 'reasoning', ['reasoning_tokens', 'reasoningTokens', 'thoughtsTokenCount', 'completion_tokens_details.reasoning_tokens']))
  usage.total_tokens = usage.total_tokens !== 0 ? usage.total_tokens : usage.input_tokens + usage.output_tokens
  return usage
}

/** 把已解析的载荷按预解析映射转为 Maheshvara。 */
export function customProtocolResponseFromRoot(
  root: unknown,
  resolved: CustomResolvedMapping,
  aliases: CustomProtocolAliases | undefined,
  configID: string,
  allowEmpty: boolean,
): MaheshvaraResponse {
  if (resolved.payloadPath !== '') {
    const { value: payload, found } = customLookupPath(root, resolved.payloadPath)
    if (found) root = payload
  }
  const mapping = resolved.mapping
  const textKeys = aliases?.textKeys
  const usageAliases = aliases?.usage
  const toolAliases = aliases?.toolCall
  const response: MaheshvaraResponse = {
    id: customStringAt(root, mapping.idPath ?? ''),
    model: customStringAt(root, mapping.modelPath ?? ''),
    created_at: Math.floor(Date.now() / 1000),
    status: customStringAt(root, mapping.statusPath ?? ''),
    stop_reason: customStringAt(root, mapping.finishReasonPath ?? ''),
  }
  if (response.status === '') {
    response.status = allowEmpty ? 'in_progress' : 'completed'
  }
  if (mapping.errorPath) {
    const value = customValueAt(root, mapping.errorPath)
    if (value !== undefined && value !== null) {
      const error: MaheshvaraError = {
        message: customValueString(value),
        class: ERROR_CLASS_UPSTREAM,
      }
      if (isPlainObject(value)) error.raw = value
      response.error = error
    }
  }
  if (mapping.textPath) {
    const text = customTextAtFilter(root, mapping.textPath, textKeys, mapping.textFilter)
    if (text !== '') {
      response.output = [...(response.output ?? []), {
        id: newMaheshvaraResponseID('msg'),
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: CONTENT_TEXT, text }],
      }]
    }
  }
  if (mapping.reasoningPath) {
    const reasoning = customTextAtFilter(root, mapping.reasoningPath, textKeys, mapping.reasoningFilter)
    if (reasoning !== '') {
      response.output = [...(response.output ?? []), {
        id: newMaheshvaraResponseID('rs'),
        type: 'reasoning',
        status: 'completed',
        content: [{ type: CONTENT_REASONING, text: reasoning, reasoning_text: reasoning }],
      }]
    }
  }
  if (mapping.toolCallsPath) {
    const items = customArrayAt(root, mapping.toolCallsPath) ?? []
    items.forEach((item, index) => {
      const call = customToolCallWithAliases(item, index, toolAliases)
      if (call.name === '') return
      response.output = [...(response.output ?? []), {
        id: call.id !== '' ? call.id : newMaheshvaraResponseID('call'),
        type: 'function_call',
        status: 'completed',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      }]
    })
  }
  if (mapping.usagePath) {
    response.usage = customUsageAtWithAliases(root, mapping.usagePath, usageAliases)
  }
  const mapped = applyCustomFieldMappings(response, root, mapping.fieldMappings ?? [])
  if (mapped) return mapped
  if ((response.output?.length ?? 0) === 0 && response.error === undefined && !allowEmpty) {
    throw new Error(`custom protocol ${JSON.stringify(configID)} response has no mapped text, reasoning, or tool call`)
  }
  return response
}

/** 校验 fieldMappings 目标路径（首段必须是 Maheshvara 响应字段）。 */
export function validateCustomResponseTarget(path: string): void {
  const tokens = parseCustomPath(path)
  if (tokens[0].index !== undefined) {
    throw new Error('target must start with a Maheshvara response field')
  }
  assertCustomPathIndexLimit(path)
  switch (tokens[0].name) {
    case 'id':
    case 'model':
    case 'created_at':
    case 'status':
    case 'stop_reason':
    case 'incomplete_details':
    case 'metadata':
    case 'service_tier':
    case 'system_fingerprint':
    case 'output':
    case 'usage':
    case 'error':
      return
    default:
      throw new Error(`target ${JSON.stringify(path)} is not a supported Maheshvara response field`)
  }
}

function customMappingValue(root: unknown, mapping: CustomProtocolFieldMapping): { value: unknown; ok: boolean } {
  if (mapping.value !== undefined) return { value: mapping.value, ok: true }
  const source = (mapping.source ?? '').trim()
  if (source !== '') {
    const { value, found } = customLookupPath(root, source)
    if (found && !customEmptyValue(value)) return { value, ok: true }
  }
  if (mapping.default !== undefined) return { value: mapping.default, ok: true }
  return { value: undefined, ok: false }
}

function customUsageMap(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {}
  const object = value
  const result: Record<string, unknown> = {}
  const copyUsage = (target: string, keys: string[]): void => {
    for (const key of keys) {
      if (key in object) {
        result[target] = object[key]
        return
      }
    }
  }
  copyUsage('input_tokens', ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount'])
  copyUsage('output_tokens', ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount'])
  copyUsage('total_tokens', ['total_tokens', 'totalTokens', 'totalTokenCount'])
  copyUsage('cached_input_tokens', ['cached_input_tokens', 'cachedInputTokens', 'cached_tokens', 'cachedContentTokenCount'])
  copyUsage('reasoning_tokens', ['reasoning_tokens', 'reasoningTokens', 'thoughtsTokenCount'])
  if (!('total_tokens' in result)) {
    const input = customNumberValue(result['input_tokens']) ?? 0
    const output = customNumberValue(result['output_tokens']) ?? 0
    if (input !== 0 || output !== 0) {
      result['total_tokens'] = Math.trunc(input + output)
    }
  }
  return result
}

function customArrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function customToolOutputItems(value: unknown): unknown[] {
  const array = customArrayValue(value)
  const result: unknown[] = []
  array.forEach((item, index) => {
    const call = customToolCallWithAliases(item, index, undefined)
    if (call.name === '') return
    result.push({
      id: call.id, type: 'function_call', status: 'completed', call_id: call.id,
      name: call.name, arguments: call.arguments,
    })
  })
  return result
}

function customOutputItems(value: unknown): unknown[] {
  const array = customArrayValue(value)
  const result: unknown[] = []
  array.forEach((item, index) => {
    if (!isPlainObject(item)) {
      const text = customTextValue(item)
      if (text !== '') {
        result.push({ type: 'message', status: 'completed', role: 'assistant', content: [{ type: CONTENT_TEXT, text }] })
      }
      return
    }
    const object = item
    const text = customTextValue([object['text'], object['content'], object['message'], object['output']].find((candidate) => candidate !== undefined && candidate !== null))
    if (text !== '') {
      const idValue = typeof object['id'] === 'string' ? object['id'] : ''
      result.push({
        id: idValue !== '' ? idValue : `msg_${index}`,
        type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: CONTENT_TEXT, text }],
      })
    }
    const calls = [object['tool_calls'], object['function_calls'], object['calls']].find((candidate) => candidate !== undefined && candidate !== null)
    for (const generated of customToolOutputItems(calls)) {
      result.push(generated)
    }
  })
  return result
}

export function transformCustomMappingValue(value: unknown, transform: string): unknown {
  switch ((transform ?? '').trim().toLowerCase()) {
    case '':
    case 'identity':
    case 'raw':
      return value
    case 'string':
    case 'text':
    case 'join':
      return customTextValue(value)
    case 'int':
    case 'integer':
    case 'number': {
      const number = customNumberValue(value)
      if (number === undefined) throw new Error('value is not numeric')
      return Math.trunc(number)
    }
    case 'float': {
      const number = customNumberValue(value)
      if (number === undefined) throw new Error('value is not numeric')
      return number
    }
    case 'bool':
    case 'boolean': {
      if (typeof value === 'boolean') return value
      const lowered = customValueString(value).trim().toLowerCase()
      if (lowered === '1' || lowered === 't' || lowered === 'true') return true
      if (lowered === '0' || lowered === 'f' || lowered === 'false') return false
      throw new Error('value is not boolean')
    }
    case 'json':
    case 'parse_json': {
      if (typeof value === 'string') return JSON.parse(value)
      return value
    }
    case 'json_string':
      return JSON.stringify(value)
    case 'timestamp_ms': {
      const number = customNumberValue(value)
      if (number === undefined) throw new Error('value is not numeric')
      return Math.trunc(number / 1000)
    }
    case 'first': {
      if (Array.isArray(value) && value.length > 0) return value[0]
      return value
    }
    case 'usage':
      return customUsageMap(value)
    case 'content_parts':
      return interfaceToContentParts(value)
    case 'tool_calls':
      return customToolOutputItems(value)
    case 'output_items':
      return customOutputItems(value)
    default:
      throw new Error(`unsupported transform ${JSON.stringify(transform)}`)
  }
}

/**
 * 在序列化视图上应用 fieldMappings：目标路径已在校验期保证合法，
 * 变换失败抛错（逐字段带索引）。
 */
function applyCustomFieldMappings(
  response: MaheshvaraResponse,
  root: unknown,
  mappings: CustomProtocolFieldMapping[],
): MaheshvaraResponse | undefined {
  if (mappings.length === 0) return undefined
  const target = JSON.parse(canonicalFreeJSONStringify(response)) as Record<string, unknown>
  for (const [index, mapping] of mappings.entries()) {
    const targetPath = normalizeMaheshvaraPath(mapping.target)
    let value: unknown
    try {
      const resolved = customMappingValue(root, mapping)
      if (!resolved.ok || (mapping.omitIfEmpty && customEmptyValue(resolved.value))) continue
      value = transformCustomMappingValue(resolved.value, mapping.transform ?? '')
      setCustomPath(target, targetPath, value)
    } catch (error) {
      throw new Error(`fieldMappings[${index}]: ${(error as Error).message}`)
    }
  }
  return JSON.parse(canonicalFreeJSONStringify(target)) as MaheshvaraResponse
}

/** 普通序列化（键序保持，仅作结构往返；与 canonicalJSONStringify 的排序形区分）。 */
function canonicalFreeJSONStringify(value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

export type { MaheshvaraOutputItem }
