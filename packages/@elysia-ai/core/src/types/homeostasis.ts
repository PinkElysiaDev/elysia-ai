export interface HomeostasisState {
  timestamp: number
  energy: number
  mood: number
  sociability: number
  curiosity: number
  metadata?: Record<string, unknown>
}

export interface HomeostasisDelta {
  energy: number
  mood: number
  sociability: number
  curiosity: number
  reason: string
}

export interface HomeostasisUpdateSource {
  stimulusId?: string
  behaviorPlanId?: string
  executionPlanId?: string
  executionActionId?: string
  event?: string
  updatedBy?: string
}

export interface HomeostasisUpdateRequest {
  id: string
  stimulusId?: string
  lifeId: string
  reason: string
  delta?: Partial<Pick<
    HomeostasisDelta,
    'energy' | 'mood' | 'sociability' | 'curiosity'
  >>
  source?: HomeostasisUpdateSource
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface HomeostasisUpdateResult {
  requestId: string
  state: HomeostasisState
  delta: HomeostasisDelta
  updated: boolean
  reason: string
  metadata?: Record<string, unknown>
}

export interface HomeostasisService {
  update(request: HomeostasisUpdateRequest): Promise<HomeostasisUpdateResult>
  getState(lifeId: string): Promise<HomeostasisState | undefined>
}
