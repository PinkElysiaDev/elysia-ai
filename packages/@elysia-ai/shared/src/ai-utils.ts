/**
 * 安全地将 unknown 值转换为 [min, max] 范围内的数字。
 * 用于解析 AI 返回的 JSON 中的数值字段。
 */
export function safeNumber(value: unknown, fallback: number, min = 0, max = 1): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

/**
 * 解析 AI 返回的 JSON 字符串，支持去除 markdown code fence。
 * 解析失败时返回 undefined。
 */
export function parseAiJsonResponse(output: string): Record<string, unknown> | undefined {
  try {
    const trimmed = output.trim()
    const jsonText = trimmed.startsWith('```')
      ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      : trimmed
    const parsed = JSON.parse(jsonText)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}
