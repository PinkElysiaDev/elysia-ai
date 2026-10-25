/**
 * 字段级双向映射模型的编译层：请求体注解树 → 模板文本；返回体构造树与
 * 字段级行映射 → 引擎的响应结构（直接路径 + fieldMappings）。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol_mapping.go` 逐函数对齐。
 *
 * request.body 是「结构即配置」的树：容器为普通 JSON 对象/数组；叶子为
 * 字段引用 {field, mode?, default?, omitIfEmpty?, omitIf?, when?} 或常量
 * {value}。含字段引用叶子的 body 按新模型编译；不含的 body 维持 legacy
 * 语义（原样作为模板文本）。
 */

import type {
  CustomProtocolFieldMapping,
  CustomProtocolMatch,
  CustomProtocolMatchSet,
  CustomProtocolResponse,
  CustomProtocolResponseFieldMapping,
} from './types.js'
import { lookupRequestFieldSpec, validateResponseFieldName } from './schema.js'
import { isSupportedCustomMappingTransform } from './schema.js'
import { parseCustomPath } from './paths.js'
import { validateCustomProtocolMatch } from './match.js'
import type { CustomOmitRule } from './template.js'
import { CUSTOM_MAHESHVARA_PREFIX } from './template.js'

export interface CustomBodyCompileResult {
  template: string
  omitIfEmpty: string[]
  omitRules: CustomOmitRule[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断 request.body 是否为含字段引用的新模型树（否则维持 legacy 模板语义）。 */
export function hasCustomProtocolAnnotationBody(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false
  return scanAnnotationNode(raw)
}

function scanAnnotationNode(value: unknown): boolean {
  if (Array.isArray(value)) {
    for (const child of value) {
      if (scanAnnotationNode(child)) return true
    }
    return false
  }
  if (isPlainObject(value)) {
    if ('field' in value) return true
    for (const child of Object.values(value)) {
      if (scanAnnotationNode(child)) return true
    }
  }
  return false
}

/**
 * 把字段引用树编译为 bodyTemplate 文本与自动收集的 omitIfEmpty 路径。
 * 叶子语义：mode string → 引号内占位符（字符串转义）；mode json（默认）→
 * 裸占位符（原生 JSON 值）；default 追加 | default: 过滤器。
 */
export function compileCustomProtocolBody(raw: unknown): CustomBodyCompileResult {
  const omit: string[] = []
  const rules: CustomOmitRule[] = []
  let builder = ''
  const write = (text: string) => { builder += text }
  compileBodyNode(raw, '', write, omit, rules)
  return { template: builder, omitIfEmpty: omit, omitRules: rules }
}

function compileBodyNode(
  value: unknown,
  path: string,
  write: (text: string) => void,
  omit: string[],
  rules: CustomOmitRule[],
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      write('[]')
      return
    }
    write('[')
    value.forEach((item, index) => {
      if (index > 0) write(', ')
      compileBodyNode(item, `${path}[${index}]`, write, omit, rules)
    })
    write(']')
    return
  }
  if (isPlainObject(value)) {
    if ('field' in value) {
      compileBodyLeaf(value, path, write, omit, rules)
      return
    }
    if ('value' in value && Object.keys(value).length === 1) {
      write(JSON.stringify(value['value']))
      return
    }
    // 注解键出现但缺 field：几乎必是写错的字段引用，按错误处理而不是
    // 静默落成字面量（确需含这些键名的常量对象可用 {"value": {...}} 表达）。
    for (const suspicious of ['mode', 'default', 'omitIfEmpty', 'omitIf', 'when']) {
      if (suspicious in value) {
        throw new Error(`request.body node at ${JSON.stringify(path)} has ${JSON.stringify(suspicious)} but is missing "field"`)
      }
    }
    const keys = Object.keys(value)
    if (keys.length === 0) {
      write('{}')
      return
    }
    keys.sort()
    write('{')
    keys.forEach((key, index) => {
      if (index > 0) write(', ')
      write(`${JSON.stringify(key)}: `)
      compileBodyNode(value[key], joinBodyPath(path, key), write, omit, rules)
    })
    write('}')
    return
  }
  // 标量直接落到树里按常量处理（等价 {"value": x}，书写更自然）。
  write(JSON.stringify(value) ?? 'null')
}

function compileBodyLeaf(
  node: Record<string, unknown>,
  path: string,
  write: (text: string) => void,
  omit: string[],
  rules: CustomOmitRule[],
): void {
  for (const key of Object.keys(node)) {
    switch (key) {
      case 'field':
      case 'mode':
      case 'default':
      case 'omitIfEmpty':
      case 'omitIf':
      case 'when':
        break
      default:
        throw new Error(`request.body field reference at ${JSON.stringify(path)} has unknown key ${JSON.stringify(key)} (allowed: field, mode, default, omitIfEmpty, omitIf, when)`)
    }
  }
  let field = typeof node['field'] === 'string' ? node['field'] : ''
  field = field.trim()
  if (field === '') {
    throw new Error(`request.body field reference at ${JSON.stringify(path)} is missing "field"`)
  }
  // field 允许「目录字段.子路径」（如 thinking.enabled）：基名必须在请求
  // 字段目录中，子路径交给渲染引擎的点路径解析。
  const dot = field.indexOf('.')
  const base = dot >= 0 ? field.slice(0, dot) : field
  const subpath = dot >= 0 ? field.slice(dot + 1) : ''
  const spec = lookupRequestFieldSpec(base)
  if (!spec) {
    throw new Error(`request.body references unknown Maheshvara field ${JSON.stringify(field)} at ${JSON.stringify(path)}`)
  }
  if (subpath !== '') {
    try {
      parseCustomPath(subpath)
    } catch (error) {
      throw new Error(`request.body field ${JSON.stringify(field)} at ${JSON.stringify(path)} has invalid subpath: ${(error as Error).message}`)
    }
  }
  let mode = typeof node['mode'] === 'string' ? node['mode'] : ''
  switch (mode.trim().toLowerCase()) {
    case '':
      mode = 'json'
      break
    case 'json':
      mode = 'json'
      break
    case 'string':
      mode = 'string'
      break
    default:
      throw new Error(`request.body field ${JSON.stringify(field)} at ${JSON.stringify(path)} uses unsupported mode ${JSON.stringify(mode)} (allowed: json, string)`)
  }
  if (!('mode' in node)) {
    // 未显式指定时按字段形态选默认：string 形态放引号内更符合直觉。
    if (spec.shape === 'string') mode = 'string'
  }
  let expression = CUSTOM_MAHESHVARA_PREFIX + field
  if ('default' in node) {
    expression += ' | default:' + JSON.stringify(node['default'])
  }
  if (node['omitIfEmpty'] === true) {
    if (path === '') throw new Error('request.body omitIfEmpty is not allowed at the root')
    omit.push(path)
  }
  const rule: CustomOmitRule = { path, field }
  if ('when' in node) {
    if (path === '') throw new Error('request.body when is not allowed at the root')
    const when = node['when']
    if (!isPlainObject(when)) {
      throw new Error(`request.body when at ${JSON.stringify(path)} is not a condition object`)
    }
    const match: CustomProtocolMatch = {
      path: typeof when['path'] === 'string' ? when['path'] : '',
      op: typeof when['op'] === 'string' ? when['op'] : undefined,
      value: when['value'],
    }
    // 条件路径相对 Maheshvara 请求根（与字段引用一致）；显式 maheshvara./
    // request. 前缀原样保留。
    if (!match.path.startsWith(CUSTOM_MAHESHVARA_PREFIX) && !match.path.startsWith('request.')) {
      match.path = CUSTOM_MAHESHVARA_PREFIX + match.path
    }
    validateCustomProtocolMatch(`request.body when at ${JSON.stringify(path)}`, match)
    rule.when = match
  }
  if ('omitIf' in node) {
    if (path === '') throw new Error('request.body omitIf is not allowed at the root')
    rule.omitIf = node['omitIf']
  }
  if (rule.when !== undefined || rule.omitIf !== undefined) {
    rules.push(rule)
  }
  if (mode === 'string') {
    write(`"${'{{' + expression + '}}'}"`)
  } else {
    write(`{{${expression}}}`)
  }
}

function joinBodyPath(parent: string, key: string): string {
  if (parent === '') return key
  return `${parent}.${key}`
}

/**
 * 把字段映射列表编译为引擎的响应结构：语义直接字段（text/usage/...）展开为
 * 直接路径；usage.* 与其余目录字段展开为 fieldMappings（usage.* 默认 int）。
 */
export function compileCustomProtocolResponseFields(
  location: string,
  fields: CustomProtocolResponseFieldMapping[],
): CustomProtocolResponse {
  const compiled: CustomProtocolResponse = {}
  const directSeen = new Set<string>()
  for (const field of fields) {
    const path = (field.path ?? '').trim()
    const name = (field.field ?? '').trim()
    if (path === '' || name === '') {
      throw new Error(`${location}: field mapping requires path and field`)
    }
    parseCustomPath(path)
    validateResponseFieldName(name)
    if ((field.transform ?? '') !== '' && !isSupportedCustomMappingTransform(field.transform!)) {
      throw new Error(`${location}: unsupported transform ${JSON.stringify(field.transform)}`)
    }
    const targets: Record<string, keyof CustomProtocolResponse> = {
      text: 'textPath',
      reasoning: 'reasoningPath',
      tool_calls: 'toolCallsPath',
      usage: 'usagePath',
      stop_reason: 'finishReasonPath',
      id: 'idPath',
      model: 'modelPath',
      status: 'statusPath',
      error: 'errorPath',
    }
    const targetKey = targets[name]
    if (targetKey) {
      if (compiled[targetKey]) {
        throw new Error(`${location}: ${name} is mapped twice`)
      }
      ;(compiled as Record<string, unknown>)[targetKey] = path
      continue
    }
    // 其余目录字段（usage.*、metadata.* 等）落为 fieldMappings 行。
    if (directSeen.has(name)) {
      throw new Error(`${location}: ${name} is mapped twice`)
    }
    directSeen.add(name)
    const mapping: CustomProtocolFieldMapping = {
      target: name,
      source: path,
      transform: (field.transform ?? '').trim() || undefined,
    }
    if (name.startsWith('usage.') && !mapping.transform) {
      mapping.transform = 'int'
    }
    compiled.fieldMappings = [...(compiled.fieldMappings ?? []), mapping]
  }
  return compiled
}

export function validateResponseFieldMappings(location: string, fields: CustomProtocolResponseFieldMapping[]): void {
  if (fields.length === 0) return
  const seen = new Map<string, string>()
  fields.forEach((field, index) => {
    const path = (field.path ?? '').trim()
    const name = (field.field ?? '').trim()
    if (path === '' || name === '') {
      throw new Error(`${location}.fields[${index}] requires path and field`)
    }
    try {
      parseCustomPath(path)
    } catch (error) {
      throw new Error(`${location}.fields[${index}].path: ${(error as Error).message}`)
    }
    try {
      validateResponseFieldName(name)
    } catch (error) {
      throw new Error(`${location}.fields[${index}]: ${(error as Error).message}`)
    }
    if ((field.transform ?? '') !== '' && !isSupportedCustomMappingTransform(field.transform!)) {
      throw new Error(`${location}.fields[${index}] uses unsupported transform ${JSON.stringify(field.transform)}`)
    }
    if (seen.has(name)) {
      throw new Error(`${location}.fields[${index}] maps ${JSON.stringify(name)} twice (also ${seen.get(name)})`)
    }
    seen.set(name, path)
  })
  compileCustomProtocolResponseFields(location, fields)
}

/** 返回「编译结果覆盖 legacy 字段」的响应映射。 */
export function effectiveCustomProtocolResponse(
  location: string,
  response: CustomProtocolResponse,
): CustomProtocolResponse {
  const fields = effectiveResponseFieldMappings(location, response)
  if (fields.length === 0) return response
  const compiled = compileCustomProtocolResponseFields(location, fields)
  const merged: CustomProtocolResponse = { ...response }
  for (const key of ['idPath', 'modelPath', 'statusPath', 'textPath', 'reasoningPath', 'toolCallsPath', 'usagePath', 'finishReasonPath', 'errorPath'] as const) {
    const compiledValue = compiled[key]
    if (compiledValue) merged[key] = compiledValue
  }
  if ((compiled.fieldMappings?.length ?? 0) > 0) {
    merged.fieldMappings = [...(compiled.fieldMappings ?? []), ...(response.fieldMappings ?? [])]
  }
  return merged
}

const REGEXP_IDENTIFIER_ONLY = /^[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * 从返回体构造树提取字段映射：叶子为映射标注 {field, value?, transform?}；
 * {value} 与裸标量为纯结构占位。路径按树位置生成（特殊键名用 ['key'] 形式）。
 */
export function extractResponseBodyFields(location: string, raw: unknown): CustomProtocolResponseFieldMapping[] {
  if (raw === undefined || raw === null) return []
  const fields: CustomProtocolResponseFieldMapping[] = []
  const seen = new Map<string, string>()
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (!isPlainObject(node)) return
    if (typeof node['field'] === 'string') {
      const name = node['field'].trim()
      if (name === '') {
        throw new Error(`${location}.body node at ${JSON.stringify(path)} has empty "field"`)
      }
      for (const key of Object.keys(node)) {
        switch (key) {
          case 'field':
          case 'value':
          case 'transform':
            break
          default:
            throw new Error(`${location}.body field node at ${JSON.stringify(path)} has unknown key ${JSON.stringify(key)} (allowed: field, value, transform)`)
        }
      }
      const transform = typeof node['transform'] === 'string' ? node['transform'] : ''
      if (seen.has(name)) {
        throw new Error(`${location}.body maps ${JSON.stringify(name)} twice (${seen.get(name)} and ${path})`)
      }
      seen.set(name, path)
      fields.push({ path, field: name, transform: transform.trim() || undefined })
      return
    }
    if ('transform' in node) {
      throw new Error(`${location}.body node at ${JSON.stringify(path)} has "transform" but is missing "field"`)
    }
    if ('value' in node && Object.keys(node).length === 1) return // 纯结构占位
    if ('mode' in node) {
      throw new Error(`${location}.body node at ${JSON.stringify(path)} uses request-side key "mode" (response fields allow: field, value, transform)`)
    }
    const keys = Object.keys(node).sort()
    for (const key of keys) {
      walk(node[key], joinResponseBodyPath(path, key))
    }
  }
  walk(raw, '$')
  return fields
}

function joinResponseBodyPath(parent: string, key: string): string {
  if (key.length > 0 && key[0] !== '[' && REGEXP_IDENTIFIER_ONLY.test(key)) {
    return `${parent}.${key}`
  }
  return `${parent}['${key.replaceAll('\'', '\\\'')}']`
}

/**
 * 合并返回体构造树的提取结果与显式 fields：两者重复声明同一字段视为配置
 * 错误（body 与 fields 二选一）。
 */
export function effectiveResponseFieldMappings(
  location: string,
  response: CustomProtocolResponse,
): CustomProtocolResponseFieldMapping[] {
  const fromBody = extractResponseBodyFields(location, response.body)
  const merged = [...fromBody]
  const seen = new Map<string, string>()
  for (const field of fromBody) {
    seen.set(field.field.trim(), field.path)
  }
  for (const field of response.fields ?? []) {
    const name = (field.field ?? '').trim()
    if (seen.has(name)) {
      throw new Error(`${location} maps ${JSON.stringify(name)} twice (previously at ${seen.get(name)})`)
    }
    seen.set(name, field.path)
    merged.push(field)
  }
  return merged
}

/**
 * 计算运行时生效的响应映射：字段级映射编译结果覆盖 legacy 字段；流式事件
 * 再切换到 stream.response（其字段映射同样编译覆盖）。payloadPath 解包由
 * 调用方在原始响应上完成。
 */
export function effectiveCustomProtocolRuntimeMapping(
  config: { response?: CustomProtocolResponse },
  allowStreamEvent: boolean,
): CustomProtocolResponse {
  let mapping: CustomProtocolResponse = config.response ?? {}
  if ((mapping.fields?.length ?? 0) > 0 || mapping.body !== undefined) {
    mapping = effectiveCustomProtocolResponse('response', mapping)
  }
  // 空嵌套映射（设计器旧版开关写入的 {body:{}}）视为未声明：保留顶层映射，
  // 否则流帧什么都映射不到。
  if (allowStreamEvent && mapping.stream?.response && customProtocolResponseHasMapping(mapping.stream.response)) {
    let nested = mapping.stream.response
    if ((nested.fields?.length ?? 0) > 0 || nested.body !== undefined) {
      nested = effectiveCustomProtocolResponse('response.stream.response', nested)
    }
    mapping = nested
  }
  return mapping
}

/**
 * 判定一份响应映射是否声明了任何可产出的字段：九个直接路径 / mappings /
 * fieldMappings / fields 任一非空，或 body 构造树非空。
 */
export function customProtocolResponseHasMapping(response: CustomProtocolResponse): boolean {
  if (
    response.idPath || response.modelPath || response.statusPath
    || response.textPath || response.reasoningPath || response.toolCallsPath
    || response.usagePath || response.finishReasonPath || response.errorPath
  ) return true
  if ((response.mappings && Object.keys(response.mappings).length > 0)
    || (response.fieldMappings?.length ?? 0) > 0
    || (response.fields?.length ?? 0) > 0) return true
  const body = response.body
  return body !== undefined && body !== null && !(isPlainObject(body) && Object.keys(body).length === 0)
}

export type { CustomProtocolMatchSet }
