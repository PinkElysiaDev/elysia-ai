/**
 * 通用条件原语：在事件载荷（或请求上下文）上按点路径取值，与任意类型的
 * 预期值做类型化比较。流终止判定（finishWhen/statusWhen）、谓词帧
 * （frame.match）、请求叶子条件（when）、数组元素过滤（textFilter）共用。
 * 与 Elysia-Api（Go）`backend/relay/custom_match.go` 逐函数对齐。
 *
 * op 语义（缺省 nonEmpty）：
 *   - nonEmpty / isEmpty：值存在且非 null；字符串需非空白，false/0/[]/{} 视为空
 *   - equals / notEquals：类型化相等（数字按数值、布尔按布尔、对象/数组按规范 JSON）
 *   - in / notIn：value 须为数组，成员类型化包含
 *   - contains：值为字符串且包含 value 字符串
 *   - isNull / notNull：缺失或 JSON null 算 null
 *   - isTrue / isFalse：布尔判定；缺失按 false（isFalse 对缺失亦为真）
 *   - gt / gte / lt / lte：数值比较（字符串数字可解析则参与）
 */

import type { CustomProtocolMatch, CustomProtocolMatchSet } from './types.js'
import { canonicalJSONStringify, customLookupPath, customNumberValue, customValueString, parseCustomPath } from './paths.js'

export const MATCH_OP_NON_EMPTY = 'nonEmpty'
export const MATCH_OP_IS_EMPTY = 'isEmpty'
export const MATCH_OP_EQUALS = 'equals'
export const MATCH_OP_NOT_EQUALS = 'notEquals'
export const MATCH_OP_IN = 'in'
export const MATCH_OP_NOT_IN = 'notIn'
export const MATCH_OP_CONTAINS = 'contains'
export const MATCH_OP_IS_NULL = 'isNull'
export const MATCH_OP_NOT_NULL = 'notNull'
export const MATCH_OP_IS_TRUE = 'isTrue'
export const MATCH_OP_IS_FALSE = 'isFalse'
export const MATCH_OP_GT = 'gt'
export const MATCH_OP_GTE = 'gte'
export const MATCH_OP_LT = 'lt'
export const MATCH_OP_LTE = 'lte'

const CUSTOM_MATCH_OPS = new Set<string>([
  MATCH_OP_NON_EMPTY, MATCH_OP_IS_EMPTY, MATCH_OP_EQUALS, MATCH_OP_NOT_EQUALS,
  MATCH_OP_IN, MATCH_OP_NOT_IN, MATCH_OP_CONTAINS, MATCH_OP_IS_NULL, MATCH_OP_NOT_NULL,
  MATCH_OP_IS_TRUE, MATCH_OP_IS_FALSE, MATCH_OP_GT, MATCH_OP_GTE, MATCH_OP_LT, MATCH_OP_LTE,
])

function matchOpNeedsValue(op: string): boolean {
  switch (op) {
    case MATCH_OP_EQUALS:
    case MATCH_OP_NOT_EQUALS:
    case MATCH_OP_IN:
    case MATCH_OP_NOT_IN:
    case MATCH_OP_CONTAINS:
    case MATCH_OP_GT:
    case MATCH_OP_GTE:
    case MATCH_OP_LT:
    case MATCH_OP_LTE:
      return true
  }
  return false
}

/** 校验条件原语：路径合法、操作符已知、需要 value 的操作符必须携带且类型正确。 */
export function validateCustomProtocolMatch(location: string, match: CustomProtocolMatch): void {
  if (match.path.trim() === '') {
    throw new Error(`${location}.path is required`)
  }
  try {
    parseCustomPath(match.path)
  } catch (error) {
    throw new Error(`${location}.path: ${(error as Error).message}`)
  }
  let op = (match.op ?? '').trim()
  if (op === '') op = MATCH_OP_NON_EMPTY
  if (!CUSTOM_MATCH_OPS.has(op)) {
    throw new Error(`${location}.op ${JSON.stringify(match.op)} is unsupported`)
  }
  if (!matchOpNeedsValue(op)) return
  if (match.value === undefined) {
    throw new Error(`${location}.op ${JSON.stringify(op)} requires value`)
  }
  if ((op === MATCH_OP_IN || op === MATCH_OP_NOT_IN) && !Array.isArray(match.value)) {
    throw new Error(`${location}.op ${JSON.stringify(op)} requires value to be an array`)
  }
}

/**
 * 兼容单条件对象与条件数组：数组语义为全部成立（AND），空集恒真。
 * 输入接受 Match、Match[]（presets JSON 里 textFilter 可以是单对象或数组），
 * 输出恒为数组。
 */
export function normalizeMatchSet(value: CustomProtocolMatchSet | undefined): CustomProtocolMatch[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

export function evalMatchAll(root: unknown, set: CustomProtocolMatchSet | undefined): boolean {
  for (const match of normalizeMatchSet(set)) {
    if (!customMatchEval(root, match)) return false
  }
  return true
}

/** Match 语境的「空」：空串/空白、false、0、空数组、空对象（Go customMatchEmpty）。 */
function customMatchEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'boolean') return !value
  const number = customNumberValue(value)
  if (typeof value === 'number') return number === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0
  return false
}

/** 类型化相等：数字按数值、布尔/字符串严格、对象/数组按规范 JSON 文本。 */
export function customJSONValuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) {
    return (a === undefined || a === null) && (b === undefined || b === null)
  }
  if (typeof a === 'number') {
    // 数字按数值严格比较（Go：仅 json.Number 对 json.Number）；字符串不做数字强转。
    return typeof b === 'number' && a === b
  }
  if (typeof a === 'string') return typeof b === 'string' && a === b
  if (typeof a === 'boolean') return typeof b === 'boolean' && a === b
  if (typeof a === 'object' && typeof b === 'object') {
    return canonicalJSONStringify(a) === canonicalJSONStringify(b)
  }
  return false
}

/** 在载荷根上求值条件。root 未命中/为 null 时仅 isNull/isEmpty/isFalse 族为真。 */
export function customMatchEval(root: unknown, match: CustomProtocolMatch): boolean {
  const { value, found } = customLookupPath(root, match.path)
  let op = (match.op ?? '').trim()
  if (op === '') op = MATCH_OP_NON_EMPTY
  if (op === MATCH_OP_IS_NULL) return !found || value === undefined || value === null
  if (op === MATCH_OP_NOT_NULL) return found && value !== undefined && value !== null
  if (!found || value === undefined || value === null) {
    // 缺失/null：除 isFalse（缺失按 false）外全部不成立。
    return op === MATCH_OP_IS_FALSE
  }
  const expected = match.value
  const hasExpected = expected !== undefined
  switch (op) {
    case MATCH_OP_NON_EMPTY:
      return !customMatchEmpty(value)
    case MATCH_OP_IS_EMPTY:
      return customMatchEmpty(value)
    case MATCH_OP_EQUALS:
      return hasExpected && customJSONValuesEqual(value, expected)
    case MATCH_OP_NOT_EQUALS:
      return hasExpected && !customJSONValuesEqual(value, expected)
    case MATCH_OP_IN:
    case MATCH_OP_NOT_IN: {
      const list = Array.isArray(expected) ? expected : []
      let member = false
      for (const item of list) {
        if (customJSONValuesEqual(value, item)) {
          member = true
          break
        }
      }
      return op === MATCH_OP_IN ? member : !member
    }
    case MATCH_OP_CONTAINS:
      if (!hasExpected) return false
      return customValueString(value).includes(customValueString(expected))
    case MATCH_OP_IS_TRUE:
      return value === true
    case MATCH_OP_IS_FALSE:
      return value !== true
    case MATCH_OP_GT:
    case MATCH_OP_GTE:
    case MATCH_OP_LT:
    case MATCH_OP_LTE: {
      const actual = customNumberValue(value)
      const bound = customNumberValue(expected)
      if (actual === undefined || bound === undefined) return false
      switch (op) {
        case MATCH_OP_GT:
          return actual > bound
        case MATCH_OP_GTE:
          return actual >= bound
        case MATCH_OP_LT:
          return actual < bound
        default:
          return actual <= bound
      }
    }
  }
  return false
}
