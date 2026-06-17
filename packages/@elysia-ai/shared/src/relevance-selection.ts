export interface ParsedRelevanceSelection {
  selectedIds?: unknown
  reason?: unknown
  reasonById?: unknown
}

export interface RelevanceSelectionDiagnosticsOptions {
  selector: string
  fallbackSelector?: string
  candidateCount?: number
  selectedCount?: number
  rejectedCount?: number
  usedAI: boolean
  latencyMs?: number
  timedOut?: boolean
  timeoutMs?: number
  parseError?: string
  fallbackReason?: string
  providerMetadata?: unknown
}

export function parseJsonObjectFromText(text: string, label: string): ParsedRelevanceSelection {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed
  const parsed = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} response is not a JSON object`)
  }
  return parsed as ParsedRelevanceSelection
}

export function normalizeSelectedIds(value: unknown, allowedIds: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && allowedIds.has(item)
  )))]
}

export function normalizeReasonById(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, reason] of Object.entries(value)) {
    if (typeof reason === 'string') result[key] = reason
  }
  return result
}

export function createSelectionDiagnostics(
  options: RelevanceSelectionDiagnosticsOptions,
): Record<string, unknown> {
  return {
    selector: options.selector,
    fallbackSelector: options.fallbackSelector,
    candidateCount: options.candidateCount,
    selectedCount: options.selectedCount,
    rejectedCount: options.rejectedCount,
    usedAI: options.usedAI,
    latencyMs: options.latencyMs,
    timedOut: options.timedOut,
    timeoutMs: options.timeoutMs,
    parseError: options.parseError,
    fallbackReason: options.fallbackReason,
    providerMetadata: options.providerMetadata,
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`)
      error.name = 'TimeoutError'
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
