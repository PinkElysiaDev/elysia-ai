import type { ModelGatewayRequest, RoutingResult } from '@elysia-ai/core'
import { ProviderError } from '../providers/types.js'

export interface GatewayAttemptDiagnostics {
  providerId: string
  attempt: number
  startedAt: number
  latencyMs?: number
  ok: boolean
  errorCode?: string
  statusCode?: number
  retryable?: boolean
}

export interface GatewayDiagnostics {
  route: {
    slot?: string
    providerId: string
    providerType: string
    model: string
    reason?: string
  }
  attempts: GatewayAttemptDiagnostics[]
  retryCount: number
  totalLatencyMs: number
  failedOver?: boolean
  fallbackChain?: string[]
  selectedFallbackSlot?: string
  finalErrorCode?: string
}

export interface MutableGatewayDiagnostics extends GatewayDiagnostics {
  startedAt: number
}

export function createGatewayDiagnostics(
  request: ModelGatewayRequest,
  route: RoutingResult,
): MutableGatewayDiagnostics {
  return {
    startedAt: Date.now(),
    route: {
      slot: request.slot,
      providerId: route.provider.id,
      providerType: route.provider.type,
      model: route.provider.model,
      reason: route.reason,
    },
    attempts: [],
    retryCount: 0,
    totalLatencyMs: 0,
  }
}

export function recordGatewayAttemptSuccess(
  diagnostics: MutableGatewayDiagnostics,
  attempt: Omit<GatewayAttemptDiagnostics, 'ok'>,
): void {
  diagnostics.attempts.push({
    ...attempt,
    ok: true,
  })
  diagnostics.retryCount = Math.max(0, diagnostics.attempts.length - 1)
  diagnostics.totalLatencyMs = Date.now() - diagnostics.startedAt
}

export function recordGatewayAttemptFailure(
  diagnostics: MutableGatewayDiagnostics,
  attempt: {
    providerId: string
    attempt: number
    startedAt: number
    latencyMs?: number
    error: unknown
  },
): void {
  const providerError = attempt.error instanceof ProviderError ? attempt.error : undefined
  diagnostics.attempts.push({
    providerId: attempt.providerId,
    attempt: attempt.attempt,
    startedAt: attempt.startedAt,
    latencyMs: attempt.latencyMs,
    ok: false,
    errorCode: providerError?.code ?? (attempt.error instanceof Error ? attempt.error.name : 'unknown-error'),
    statusCode: providerError?.statusCode,
    retryable: providerError?.retryable ?? true,
  })
  diagnostics.retryCount = Math.max(0, diagnostics.attempts.length - 1)
  diagnostics.totalLatencyMs = Date.now() - diagnostics.startedAt
  diagnostics.finalErrorCode = providerError?.code ?? (attempt.error instanceof Error ? attempt.error.name : 'unknown-error')
}

export function finalizeGatewayDiagnostics(
  diagnostics: MutableGatewayDiagnostics,
): GatewayDiagnostics {
  diagnostics.retryCount = Math.max(0, diagnostics.attempts.length - 1)
  diagnostics.totalLatencyMs = Date.now() - diagnostics.startedAt

  return {
    route: diagnostics.route,
    attempts: diagnostics.attempts,
    retryCount: diagnostics.retryCount,
    totalLatencyMs: diagnostics.totalLatencyMs,
    failedOver: diagnostics.failedOver,
    fallbackChain: diagnostics.fallbackChain,
    selectedFallbackSlot: diagnostics.selectedFallbackSlot,
    finalErrorCode: diagnostics.finalErrorCode,
  }
}
