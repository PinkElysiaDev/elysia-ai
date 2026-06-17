import type { BehaviorDecision, BehaviorSignal, ResponsePlan } from './behavior.js'
import type { CognitionContext, CognitionResult } from './cognition.js'
import type { HomeostasisService } from './homeostasis.js'
import type { PerceptionResult } from './perception.js'
import type { Persona, PersonaRegistry } from './persona.js'
import type { Stimulus } from './stimulus.js'

export interface CapabilityDiagnostics {
  plugin: string
  enabled: boolean
  ready: boolean
  serviceName: string
  metadata?: Record<string, unknown>
}

export interface BehaviorService {
  decide(stimulus: Stimulus, signal?: Partial<BehaviorSignal>): Promise<BehaviorDecision>
  createResponsePlan(decision: BehaviorDecision): ResponsePlan
  getDiagnostics(): CapabilityDiagnostics
}

export interface PerceptionService {
  process(stimulus: Stimulus): Promise<PerceptionResult>
  getDiagnostics(): CapabilityDiagnostics
}

export interface CognitionService {
  reason(context: CognitionContext): Promise<CognitionResult>
  getDiagnostics(): CapabilityDiagnostics
}

export interface PersonaService {
  register(persona: Persona): void
  getByLifeId(lifeId: string): Persona | undefined
  getAll(): Persona[]
  getRegistry(): PersonaRegistry
  getDiagnostics(): CapabilityDiagnostics
}

export interface ObservatoryServiceFacade {
  recordEvent(eventName: string, payload: unknown): void
  queryEvents(query?: Record<string, unknown>): unknown[]
  getSnapshot(): unknown
  getOperationalSnapshot?(): unknown
  getDiagnostics(): CapabilityDiagnostics
}

export interface BodyService {
  getOutboundRoutes(): unknown
  getSender(): unknown
  getDiagnostics(): CapabilityDiagnostics
}

export interface HomeostasisCapabilityService extends HomeostasisService {
  getDiagnostics?(): CapabilityDiagnostics
}

export interface RuntimeCapabilityServiceMap {
  'elysia.behavior': BehaviorService
  'elysia.perception': PerceptionService
  'elysia.cognition': CognitionService
  'elysia.persona': PersonaService
  'elysia.observatory': ObservatoryServiceFacade
  'elysia.body': BodyService
  'elysia.homeostasis': HomeostasisCapabilityService
}
