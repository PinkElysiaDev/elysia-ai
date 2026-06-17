import { ProviderError } from '../providers/types.js'

export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'circuit-open'

export interface ProviderHealthSnapshot {
  providerId: string
  status: ProviderHealthStatus
  recentSuccesses: number
  recentFailures: number
  consecutiveFailures: number
  lastSuccessAt?: number
  lastFailureAt?: number
  lastErrorCode?: string
  averageLatencyMs?: number
}

export interface ProviderHealthTrackerConfig {
  degradedFailureThreshold?: number
  unhealthyFailureThreshold?: number
  latencySampleSize?: number
  circuitBreakerEnabled?: boolean
  circuitBreakerFailureThreshold?: number
  circuitBreakerCooldownMs?: number
}

interface ProviderHealthState {
  recentSuccesses: number
  recentFailures: number
  consecutiveFailures: number
  lastSuccessAt?: number
  lastFailureAt?: number
  lastErrorCode?: string
  latencies: number[]
  circuitOpenedAt?: number
  circuitProbeInFlight?: boolean
}

const DEFAULT_CONFIG: Required<ProviderHealthTrackerConfig> = {
  degradedFailureThreshold: 2,
  unhealthyFailureThreshold: 5,
  latencySampleSize: 20,
  circuitBreakerEnabled: false,
  circuitBreakerFailureThreshold: 3,
  circuitBreakerCooldownMs: 30000,
}

export class ProviderHealthTracker {
  private readonly states = new Map<string, ProviderHealthState>()
  private readonly config: Required<ProviderHealthTrackerConfig>

  constructor(config: ProviderHealthTrackerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  recordSuccess(providerId: string, latencyMs?: number): void {
    const state = this.getOrCreateState(providerId)
    state.recentSuccesses++
    state.consecutiveFailures = 0
    state.lastSuccessAt = Date.now()
    state.circuitOpenedAt = undefined
    state.circuitProbeInFlight = false

    if (latencyMs !== undefined && Number.isFinite(latencyMs) && latencyMs >= 0) {
      state.latencies.push(latencyMs)
      if (state.latencies.length > this.config.latencySampleSize) {
        state.latencies.shift()
      }
    }
  }

  recordFailure(providerId: string, error: unknown): void {
    const state = this.getOrCreateState(providerId)
    state.recentFailures++
    state.consecutiveFailures++
    state.lastFailureAt = Date.now()
    state.lastErrorCode = this.resolveErrorCode(error)
    state.circuitProbeInFlight = false

    if (
      this.config.circuitBreakerEnabled
      && state.consecutiveFailures >= this.config.circuitBreakerFailureThreshold
    ) {
      state.circuitOpenedAt = Date.now()
    }
  }

  getSnapshot(providerId: string): ProviderHealthSnapshot {
    const state = this.getOrCreateState(providerId)
    return {
      providerId,
      status: this.resolveStatus(state),
      recentSuccesses: state.recentSuccesses,
      recentFailures: state.recentFailures,
      consecutiveFailures: state.consecutiveFailures,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      lastErrorCode: state.lastErrorCode,
      averageLatencyMs: this.averageLatency(state.latencies),
    }
  }

  getAllSnapshots(): ProviderHealthSnapshot[] {
    return Array.from(this.states.keys()).map((providerId) => this.getSnapshot(providerId))
  }

  isAvailable(providerId: string): boolean {
    const state = this.getOrCreateState(providerId)
    if (!this.config.circuitBreakerEnabled) return true
    if (!state.circuitOpenedAt) return true

    const cooldownElapsed = Date.now() - state.circuitOpenedAt >= this.config.circuitBreakerCooldownMs
    if (!cooldownElapsed) return false
    return !state.circuitProbeInFlight
  }

  markProbeStarted(providerId: string): void {
    const state = this.getOrCreateState(providerId)
    if (state.circuitOpenedAt) {
      state.circuitProbeInFlight = true
    }
  }

  private getOrCreateState(providerId: string): ProviderHealthState {
    let state = this.states.get(providerId)
    if (!state) {
      state = {
        recentSuccesses: 0,
        recentFailures: 0,
        consecutiveFailures: 0,
        latencies: [],
      }
      this.states.set(providerId, state)
    }
    return state
  }

  private resolveStatus(state: ProviderHealthState): ProviderHealthStatus {
    if (this.config.circuitBreakerEnabled && state.circuitOpenedAt) {
      return 'circuit-open'
    }
    if (state.consecutiveFailures >= this.config.unhealthyFailureThreshold) {
      return 'unhealthy'
    }
    if (state.consecutiveFailures >= this.config.degradedFailureThreshold) {
      return 'degraded'
    }
    return 'healthy'
  }

  private resolveErrorCode(error: unknown): string {
    if (error instanceof ProviderError) {
      return error.code ?? `http-${error.statusCode ?? 'unknown'}`
    }
    if (error instanceof Error) {
      return error.name
    }
    return 'unknown-error'
  }

  private averageLatency(latencies: number[]): number | undefined {
    if (!latencies.length) return undefined
    return latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
  }
}
