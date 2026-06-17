
export type PreflightSeverity = 'error' | 'warning'

export interface PreflightIssue {
  plugin: string
  code: string
  severity: PreflightSeverity
  message: string
  metadata?: Record<string, unknown>
}

export interface PreflightResult {
  ok: boolean
  errors: PreflightIssue[]
  warnings: PreflightIssue[]
  diagnostics: Record<string, unknown>
}

export function createPreflightResult(
  issues: PreflightIssue[] = [],
  diagnostics: Record<string, unknown> = {},
): PreflightResult {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    diagnostics,
  }
}

export function issue(
  plugin: string,
  code: string,
  severity: PreflightSeverity,
  message: string,
  metadata?: Record<string, unknown>,
): PreflightIssue {
  return { plugin, code, severity, message, metadata }
}

export function combinePreflightResults(results: PreflightResult[]): PreflightResult {
  return createPreflightResult(
    results.flatMap((result) => [...result.errors, ...result.warnings]),
    Object.fromEntries(results.map((result, index) => [`result${index}`, result.diagnostics])),
  )
}
