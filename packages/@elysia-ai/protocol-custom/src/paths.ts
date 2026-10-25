/**
 * 点路径引擎与未定形 JSON 值工具。
 * 与 Elysia-Api（Go）`backend/relay/custom_mapping.go` 逐函数对齐。
 */

interface CustomPathToken {
  name?: string
  index?: number
}

/** fieldMappings 目标路径中的数组下标上限：setCustomPath 按需填充 null 至目标下标。 */
const CUSTOM_PATH_MAX_INDEX = 4096

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCustomPath(path: string): CustomPathToken[] {
  let trimmed = path.trim()
  if (trimmed.startsWith('$')) trimmed = trimmed.slice(1)
  if (trimmed.startsWith('.')) trimmed = trimmed.slice(1)
  if (trimmed === '') throw new Error('empty path')

  const tokens: CustomPathToken[] = []
  let offset = 0
  while (offset < trimmed.length) {
    if (trimmed[offset] === '.') {
      offset++
      continue
    }
    const start = offset
    while (offset < trimmed.length && trimmed[offset] !== '.' && trimmed[offset] !== '[') {
      offset++
    }
    if (start !== offset) {
      const name = trimmed.slice(start, offset).trim()
      if (name === '') throw new Error(`empty path segment in ${JSON.stringify(path)}`)
      tokens.push({ name })
    }
    while (offset < trimmed.length && trimmed[offset] === '[') {
      const close = trimmed.indexOf(']', offset + 1)
      if (close < 0) throw new Error(`unterminated array segment in ${JSON.stringify(path)}`)
      const value = trimmed.slice(offset + 1, close).trim()
      if (
        value.length >= 2
        && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === '\'' && value[value.length - 1] === '\''))
      ) {
        tokens.push({ name: value.slice(1, -1) })
      } else {
        const index = Number(value)
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`invalid array index ${JSON.stringify(value)} in ${JSON.stringify(path)}`)
        }
        tokens.push({ index })
      }
      offset = close + 1
    }
    if (offset < trimmed.length && trimmed[offset] !== '.') {
      throw new Error(`invalid path syntax near ${JSON.stringify(trimmed.slice(offset))}`)
    }
  }
  if (tokens.length === 0) throw new Error(`empty path ${JSON.stringify(path)}`)
  return tokens
}

export function customLookupPath(root: unknown, path: string): { value: unknown; found: boolean } {
  let tokens: CustomPathToken[]
  try {
    tokens = parseCustomPath(path)
  } catch {
    return { value: undefined, found: false }
  }
  let current: unknown = root
  for (const token of tokens) {
    if (token.index !== undefined) {
      if (!Array.isArray(current) || token.index >= current.length) return { value: undefined, found: false }
      current = current[token.index]
      continue
    }
    if (!isPlainObject(current)) return { value: undefined, found: false }
    if (!(token.name! in current)) return { value: undefined, found: false }
    current = current[token.name!]
  }
  return { value: current, found: true }
}

export function setCustomPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const tokens = parseCustomPath(path)
  setCustomPathValue(root, tokens, value)
}

function setCustomPathValue(current: unknown, tokens: CustomPathToken[], value: unknown): unknown {
  if (tokens.length === 0) return value
  const token = tokens[0]
  if (token.index !== undefined) {
    let array: unknown[] | null = null
    if (current !== undefined && current !== null) {
      if (!Array.isArray(current)) throw new Error('path expects an array')
      array = current
    } else {
      array = []
    }
    while (array.length <= token.index) array.push(null)
    const updated = setCustomPathValue(array[token.index], tokens.slice(1), value)
    array[token.index] = updated
    return array
  }
  let object: Record<string, unknown> | null = null
  if (current === undefined || current === null) {
    object = {}
  } else {
    if (!isPlainObject(current)) throw new Error(`path expects an object before ${JSON.stringify(token.name)}`)
    object = current
  }
  const updated = setCustomPathValue(object[token.name!], tokens.slice(1), value)
  object[token.name!] = updated
  return object
}

/**
 * 无条件删除路径（空值/条件省略统一删除阶段用）：命中即删，值非空也删；
 * 子项删除后为空的父容器一并修剪。数组元素删除返回缩短后的新数组。
 */
export function deleteCustomPathForce(root: unknown, path: string): unknown {
  let tokens: CustomPathToken[]
  try {
    tokens = parseCustomPath(path)
  } catch {
    return root
  }
  return deleteCustomPathValueForce(root, tokens).value
}

function deleteCustomPathValueForce(current: unknown, tokens: CustomPathToken[]): { value: unknown; deleted: boolean } {
  if (tokens.length === 0) return { value: current, deleted: true }
  const token = tokens[0]
  if (token.index !== undefined) {
    if (!Array.isArray(current) || token.index >= current.length) return { value: current, deleted: false }
    const array = [...current]
    if (tokens.length === 1) {
      array.splice(token.index, 1)
      return { value: array, deleted: true }
    }
    const result = deleteCustomPathValueForce(array[token.index], tokens.slice(1))
    if (!result.deleted) return { value: current, deleted: false }
    array[token.index] = result.value
    if (customEmptyValue(array[token.index])) {
      array.splice(token.index, 1)
      return { value: array, deleted: true }
    }
    return { value: array, deleted: true }
  }
  if (!isPlainObject(current)) return { value: current, deleted: false }
  const object = current
  if (!(token.name! in object)) return { value: current, deleted: false }
  if (tokens.length === 1) {
    delete object[token.name!]
    return { value: current, deleted: true }
  }
  const result = deleteCustomPathValueForce(object[token.name!], tokens.slice(1))
  if (!result.deleted) return { value: current, deleted: false }
  object[token.name!] = result.value
  if (customEmptyValue(object[token.name!])) {
    delete object[token.name!]
  }
  return { value: current, deleted: true }
}

/**
 * 引擎通用的「空」判定（Go customEmptyValue）：null/缺失、空白字符串、
 * 空数组、空对象视为空；false/0 非空（与 Match 语境的 customMatchEmpty 不同，
 * 后者把 false/0 也视为空——用户配置 Match 即显式选择该语义）。
 */
export function customEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

/** 任意值 → 字符串：字符串原样、数字/布尔字面量、其余 JSON 序列化（Go customValueString）。 */
export function customValueString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 规范形 JSON 文本（对象键递归排序）：对齐 Go json.Marshal 的 map 键有序
 * 输出，作为对象/数组类型化相等比较的规范形。
 */
export function canonicalJSONStringify(value: unknown): string {
  if (value === undefined || value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJSONStringify(item)).join(',')}]`
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSONStringify(object[key])}`).join(',')}}`
}

/** 数值提取：数字直接、字符串可解析则解析（Go numberValue 的引擎方言）。 */
export function customNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (value.trim() !== '' && Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** 限制校验：目标路径下标上限（对齐 customPathMaxIndex）。 */
export function assertCustomPathIndexLimit(path: string): void {
  const tokens = parseCustomPath(path)
  for (const token of tokens) {
    if (token.index !== undefined && token.index > CUSTOM_PATH_MAX_INDEX) {
      throw new Error(`array index ${token.index} exceeds the limit ${CUSTOM_PATH_MAX_INDEX} in target ${JSON.stringify(path)}`)
    }
  }
}
