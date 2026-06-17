export interface HomeostasisLogger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

export interface HomeostasisState {
  lifeInstanceId: string
  timestamp: number
  energy: number
  mood: number
  sociability: number
  curiosity: number
  responseThreshold: number
  metadata?: Record<string, unknown>
}

export interface HomeostasisDelta {
  lifeInstanceId: string
  energy: number
  mood: number
  sociability: number
  curiosity: number
  responseThreshold: number
  reason: string
}
