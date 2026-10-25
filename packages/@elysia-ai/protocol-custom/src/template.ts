/**
 * 模板引擎：{{maheshvara.<field>}} 占位符渲染（JSON 值 / 引号内字符串两种
 * 嵌入形态）+ |default |bool |int |string |json 过滤器 + Maheshvara 请求
 * 模板上下文构造。与 Elysia-Api（Go）`backend/relay/custom_protocol.go`
 * 的模板族函数逐行为对齐。
 */

import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import { customEmptyValue, customLookupPath, customValueString, deleteCustomPathForce } from './paths.js'
import { customJSONValuesEqual, customMatchEval } from './match.js'
import type { CustomProtocolMatch } from './types.js'

export const CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES = 4 << 20
export const CUSTOM_PROTOCOL_MAX_DEPTH = 64
export const CUSTOM_PROTOCOL_MAX_PLACEHOLDERS = 2048

/** 条件省略规则：when 条件不成立或字段值类型化等于 omitIf 时，渲染后强制删除该叶子路径。 */
export interface CustomOmitRule {
  path: string
  field: string
  when?: CustomProtocolMatch
  omitIf?: unknown
}

/** 模板/映射路径的 Maheshvara 请求根前缀。 */
export const CUSTOM_MAHESHVARA_PREFIX = 'maheshvara.'

/** 去空白并剥掉可选的 maheshvara. 前缀。 */
export function normalizeMaheshvaraPath(path: string): string {
  const trimmed = path.trim()
  return trimmed.startsWith(CUSTOM_MAHESHVARA_PREFIX) ? trimmed.slice(CUSTOM_MAHESHVARA_PREFIX.length) : trimmed
}

function stripRawExtraDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripRawExtraDeep(item))
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(object)) {
      // Go 侧 RawExtra 为 json:"-"，序列化即剥离；TS 对象同名属性需显式剔除。
      if (key === 'RawExtra') continue
      out[key] = stripRawExtraDeep(child)
    }
    return out
  }
  return value
}

/**
 * 模板上下文：请求以 JSON 形态挂在 maheshvara（与 request 别名）根下，
 * RawExtra 剥离后以 raw_extra/extra 两个别名回填。
 */
export function maheshvaraTemplateContext(req: MaheshvaraRequest): Record<string, unknown> {
  const value = stripRawExtraDeep(req) as Record<string, unknown>
  if (req.RawExtra && Object.keys(req.RawExtra).length > 0) {
    const extra: Record<string, unknown> = { ...req.RawExtra }
    value['raw_extra'] = extra
    value['extra'] = extra
  }
  return { maheshvara: value, request: value }
}

interface ParsedExpression {
  path: string
  defaultValue: unknown
  forceJSON: boolean
  filter: string
}

function parseGoBool(text: string): boolean | undefined {
  const lowered = text.trim().toLowerCase()
  if (lowered === '1' || lowered === 't' || lowered === 'true') return true
  if (lowered === '0' || lowered === 'f' || lowered === 'false') return false
  return undefined
}

export function parseCustomExpression(expression: string): ParsedExpression {
  const parts = expression.split('|')
  const path = parts[0].trim()
  if (path === '') throw new Error('empty template path')
  let defaultValue: unknown
  let hasDefault = false
  let forceJSON = false
  let filter = ''
  for (const rawOption of parts.slice(1)) {
    const option = rawOption.trim()
    if (option === 'json') {
      // |json：显式声明占位符按 JSON 值嵌入（带引号模板配 |json 则跳出字符串转义路径）。
      forceJSON = true
    } else if (option === 'bool' || option === 'int' || option === 'string') {
      // |bool |int |string：解析后的值做类型收敛（nil 不动）。
      filter = option
    } else if (option.startsWith('default:')) {
      const literal = option.slice('default:'.length).trim()
      if (literal === '') {
        defaultValue = ''
        hasDefault = true
        continue
      }
      try {
        defaultValue = JSON.parse(literal)
        hasDefault = true
      } catch {
        defaultValue = literal.replace(/^["']+|["']+$/g, '')
        hasDefault = true
      }
    } else {
      throw new Error(`unsupported template option ${JSON.stringify(option)}`)
    }
  }
  return { path, defaultValue: hasDefault ? defaultValue : undefined, forceJSON, filter }
}

/** 对解析出的占位符值做类型收敛；null/undefined 与转换失败保持原值。 */
function applyCustomTemplateFilter(value: unknown, filter: string): unknown {
  if (value === undefined || value === null || filter === '') return value
  switch (filter) {
    case 'bool': {
      if (typeof value === 'boolean') return value
      const parsed = parseGoBool(customValueString(value))
      return parsed === undefined ? value : parsed
    }
    case 'int': {
      const number = typeof value === 'number' && Number.isFinite(value) ? value : undefined
      if (number === undefined) return value
      return Math.trunc(number)
    }
    case 'string':
      return customValueString(value)
  }
  return value
}

/** 遍历模板中的全部 {{...}} 占位符；回调抛错立即中止。 */
export function forEachCustomPlaceholder(template: string, fn: (expression: string) => void): void {
  let placeholders = 0
  let offset = 0
  while (offset < template.length) {
    const start = template.indexOf('{{', offset)
    if (start < 0) return
    const end = template.indexOf('}}', start + 2)
    if (end < 0) throw new Error(`unterminated placeholder at byte ${start}`)
    placeholders++
    if (placeholders > CUSTOM_PROTOCOL_MAX_PLACEHOLDERS) {
      throw new Error(`template contains more than ${CUSTOM_PROTOCOL_MAX_PLACEHOLDERS} placeholders`)
    }
    fn(template.slice(start + 2, end).trim())
    offset = end + 2
  }
}

function validateCustomJSONDepth(value: unknown, depth: number): void {
  if (depth > CUSTOM_PROTOCOL_MAX_DEPTH) {
    throw new Error(`rendered JSON exceeds maximum depth ${CUSTOM_PROTOCOL_MAX_DEPTH}`)
  }
  if (Array.isArray(value)) {
    for (const item of value) validateCustomJSONDepth(item, depth + 1)
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value as Record<string, unknown>)) validateCustomJSONDepth(item, depth + 1)
  }
}

function escapeJSONString(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/**
 * 渲染 JSON 模板：占位符按上下文取值，引号包裹且未显式 |json 时按字符串
 * 转义嵌入，其余按原生 JSON 值嵌入；整体须仍是合法 JSON。
 */
function renderCustomJSON(template: string, context: Record<string, unknown>): unknown {
  let builder = ''
  let placeholders = 0
  let offset = 0
  while (offset < template.length) {
    const start = template.indexOf('{{', offset)
    if (start < 0) {
      builder += template.slice(offset)
      break
    }
    builder += template.slice(offset, start)
    const end = template.indexOf('}}', start + 2)
    if (end < 0) throw new Error(`unterminated placeholder at byte ${start}`)
    placeholders++
    if (placeholders > CUSTOM_PROTOCOL_MAX_PLACEHOLDERS) {
      throw new Error(`template contains more than ${CUSTOM_PROTOCOL_MAX_PLACEHOLDERS} placeholders`)
    }
    const expression = template.slice(start + 2, end).trim()
    const parsed = parseCustomExpression(expression)
    const { value: resolved, found } = customLookupPath(context, parsed.path)
    let finalValue = found && !customEmptyValue(resolved) ? resolved : parsed.defaultValue
    finalValue = applyCustomTemplateFilter(finalValue, parsed.filter)
    const prefix = template.slice(0, start)
    const suffix = template.slice(end + 2)
    const quoted = prefix.length > 0 && prefix[prefix.length - 1] === '"' && suffix.length > 0 && suffix[0] === '"'
    if (quoted && !parsed.forceJSON) {
      builder += escapeJSONString(customValueString(finalValue))
    } else if (finalValue === undefined) {
      // JSON.stringify(undefined) 非法：空占位按 null 嵌入（对齐 Go json.Marshal(nil)）。
      builder += 'null'
    } else {
      builder += JSON.stringify(finalValue)
    }
    offset = end + 2
  }
  try {
    return JSON.parse(builder)
  } catch (error) {
    throw new Error(`rendered body is not valid JSON: ${(error as Error).message}`)
  }
}

/**
 * 渲染 JSON 模板并执行空值/条件省略：先收集全部命中（判定阶段不改树），
 * 再按路径降序删除。omitIf 对渲染后的最终值比较（default/过滤器生效后），
 * when 仍对请求上下文求值。
 */
export function renderCustomTemplate(
  template: string,
  context: Record<string, unknown>,
  omitIfEmpty: string[],
  omitRules: CustomOmitRule[],
): unknown {
  if (template.length > CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES) {
    throw new Error(`template exceeds ${CUSTOM_PROTOCOL_MAX_TEMPLATE_BYTES} bytes`)
  }
  const value = renderCustomJSON(template, context)
  const deletions: string[] = []
  for (const path of omitIfEmpty) {
    const trimmed = normalizeMaheshvaraPath(path)
    const { value: resolved, found } = customLookupPath(value, trimmed)
    if (found && customEmptyValue(resolved)) deletions.push(trimmed)
  }
  for (const rule of omitRules) {
    let hit = rule.when !== undefined && !customMatchEval(context, rule.when)
    if (!hit && rule.omitIf !== undefined) {
      const { value: resolved, found } = customLookupPath(value, rule.path)
      if (found && customJSONValuesEqual(resolved, rule.omitIf)) hit = true
    }
    if (hit) deletions.push(rule.path)
  }
  deletions.sort()
  let result = value
  for (let index = deletions.length - 1; index >= 0; index--) {
    result = deleteCustomPathForce(result, deletions[index])
  }
  validateCustomJSONDepth(result, 0)
  return result
}

/** 渲染字符串模板（路径/请求头/查询值）：占位符按字符串嵌入，错误占位符原样保留。 */
export function renderCustomString(template: string, context: Record<string, unknown>): string {
  if (template.trim() === '') return ''
  let builder = ''
  let offset = 0
  while (offset < template.length) {
    const start = template.indexOf('{{', offset)
    if (start < 0) {
      builder += template.slice(offset)
      break
    }
    builder += template.slice(offset, start)
    const end = template.indexOf('}}', start + 2)
    if (end < 0) {
      builder += template.slice(start)
      break
    }
    let parsed: ParsedExpression
    try {
      parsed = parseCustomExpression(template.slice(start + 2, end).trim())
    } catch {
      builder += template.slice(start, end + 2)
      offset = end + 2
      continue
    }
    const { value: resolved, found } = customLookupPath(context, parsed.path)
    let finalValue = found && !customEmptyValue(resolved) ? resolved : parsed.defaultValue
    finalValue = applyCustomTemplateFilter(finalValue, parsed.filter)
    builder += customValueString(finalValue)
    offset = end + 2
  }
  return builder
}

/** 校验字符串模板的占位符表达式语法。 */
export function validateCustomStringTemplate(template: string): void {
  forEachCustomPlaceholder(template, (expression) => {
    parseCustomExpression(expression)
  })
}
