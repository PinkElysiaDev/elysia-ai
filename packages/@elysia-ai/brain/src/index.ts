import type {
  BondContextPack,
  BrainCapability,
  BrainRequest,
  BrainResponse,
  BrainService,
  CoreEventMap,
  DialogueMessage,
  EventBus,
  MemoryContextPack,
  ModelGatewayService,
  Persona,
  PersonaRegistry,
} from '@elysia-ai/core'
import { DefaultModelGatewayService } from '@elysia-ai/model-gateway'
import {
  DefaultContextBudgetPlanner,
} from './context-budget.js'
import type {
  ContextBudgetPlanner,
} from './context-budget.js'

export const internalName = 'elysia-ai-brain'

export interface ContextBudgetConfig {
  maxMemoryChars?: number
  maxBondChars?: number
  maxPersonaChars?: number
  maxSystemPromptChars?: number
  maxEstimatedTokens?: number
  tokenEstimateRatio?: number
  planner?: ContextBudgetPlanner
}

export interface Config {
  systemPrompt?: string
  contextWindow?: number
  defaultModelSlot?: string
  contextBudget?: ContextBudgetConfig
}

// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
// Persona prompt 閺嬪嫬缂?// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

function buildPersonaSystemPrompt(persona?: Persona): string | undefined {
  if (!persona) return undefined

  const parts = [persona.systemPrompt]
  if (persona.traits?.length) {
    parts.push(`Traits: ${persona.traits.join(', ')}`)
  }
  if (persona.tone) {
    parts.push(`Tone: ${persona.tone}`)
  }
  return parts.filter(Boolean).join('\n')
}

interface PromptBuildResult {
  prompt?: string
  truncated: boolean
  originalLength: number
  finalLength: number
}

function truncateText(text: string | undefined, maxChars: number | undefined): PromptBuildResult {
  if (!text) {
    return {
      prompt: undefined,
      truncated: false,
      originalLength: 0,
      finalLength: 0,
    }
  }

  if (!maxChars || maxChars <= 0 || text.length <= maxChars) {
    return {
      prompt: text,
      truncated: false,
      originalLength: text.length,
      finalLength: text.length,
    }
  }

  const suffix = '\n[Context truncated by Elysia A.I. budget governance]'
  const slicedLength = Math.max(0, maxChars - suffix.length)
  const prompt = `${text.slice(0, slicedLength)}${suffix}`
  return {
    prompt,
    truncated: true,
    originalLength: text.length,
    finalLength: prompt.length,
  }
}

function buildMemoryContextPrompt(memoryContext?: MemoryContextPack): string | undefined {
  if (!memoryContext || memoryContext.items.length === 0) return undefined

  const lines = memoryContext.items.map((item, index) => {
    const entry = item.entry
    const scope = `${entry.kind}/${entry.visibility ?? 'unknown'}/${entry.ownerType ?? entry.scope}`
    const content = entry.summary ?? entry.content
    return `${index + 1}. [${scope}] ${content} (reason: ${item.reason}; score: ${item.score.toFixed(2)})`
  })

  return [
    'Relevant long-term memories:',
    ...lines,
    'Use these memories as background facts when relevant. Do not reveal internal scores or reasons to the user.',
  ].join('\n')
}

function buildBondContextPrompt(bondContext?: BondContextPack): string | undefined {
  if (!bondContext || bondContext.items.length === 0) return undefined

  const lines = bondContext.items.map((item, index) => {
    const bond = item.bond
    const metrics = [
      `familiarity=${bond.metrics.familiarity.toFixed(2)}`,
      `intimacy=${bond.metrics.intimacy.toFixed(2)}`,
      `trust=${bond.metrics.trust.toFixed(2)}`,
      `tension=${bond.metrics.tension.toFixed(2)}`,
      `dependence=${bond.metrics.dependence.toFixed(2)}`,
    ].join(', ')
    const summary = bond.summary ? ` summary: ${bond.summary}` : ''
    const tags = bond.tags?.length ? ` tags: ${bond.tags.join(', ')}` : ''
    return `${index + 1}. [${bond.targetType}:${bond.targetId}] ${metrics}; interactions=${bond.interactionCount ?? 0}.${summary}${tags} (reason: ${item.reason}; score: ${item.score.toFixed(2)})`
  })

  return [
    'Relevant relationship context:',
    ...lines,
    'Use this relationship context to adjust tone, boundaries, familiarity, trust, and caution. Do not reveal internal scores or reasons to the user.',
  ].join('\n')
}

function buildSystemMessage(prompt?: string): DialogueMessage | null {
  if (!prompt) return null
  return { role: 'system', content: prompt }
}

function truncateMessages(messages: DialogueMessage[], window: number): DialogueMessage[] {
  if (window <= 0 || messages.length <= window) return messages
  return messages.slice(messages.length - window)
}

// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
// Brain Service
// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

export class DefaultBrainService implements BrainService {
  private readonly gateway: ModelGatewayService
  private readonly eventBus?: EventBus<CoreEventMap>
  private readonly personaRegistry?: PersonaRegistry
  private readonly defaultSystemPrompt?: string
  private readonly defaultContextWindow: number
  private readonly defaultModelSlot?: string
  private readonly contextBudget: Omit<Required<ContextBudgetConfig>, 'planner'> & {
    planner: ContextBudgetPlanner
  }

  constructor(
    config: Config = {},
    gateway?: ModelGatewayService,
    eventBus?: EventBus<CoreEventMap>,
    personaRegistry?: PersonaRegistry
  ) {
    this.eventBus = eventBus
    this.gateway = gateway ?? new DefaultModelGatewayService({}, eventBus)
    this.personaRegistry = personaRegistry
    this.defaultSystemPrompt = config.systemPrompt
    this.defaultContextWindow = config.contextWindow ?? 20
    this.defaultModelSlot = config.defaultModelSlot
    this.contextBudget = {
      maxMemoryChars: config.contextBudget?.maxMemoryChars ?? 4000,
      maxBondChars: config.contextBudget?.maxBondChars ?? 3000,
      maxPersonaChars: config.contextBudget?.maxPersonaChars ?? 2000,
      maxSystemPromptChars: config.contextBudget?.maxSystemPromptChars ?? 12000,
      maxEstimatedTokens: config.contextBudget?.maxEstimatedTokens ?? 3000,
      tokenEstimateRatio: config.contextBudget?.tokenEstimateRatio ?? 4,
      planner: config.contextBudget?.planner ?? new DefaultContextBudgetPlanner(),
    }
  }

  async execute(request: BrainRequest): Promise<BrainResponse> {
    await this.eventBus?.emit('brain.requested', { request })

    try {
      // Persona 濞夈劌鍙嗘导妯哄帥缁狙嶇窗request.systemPrompt > persona(systemPrompt + traits + tone) > config.systemPrompt
      const persona = request.lifeId
        ? this.personaRegistry?.getByLifeId(request.lifeId)
        : undefined
      const personaPrompt = buildPersonaSystemPrompt(persona)
      const baseSystemPrompt = request.systemPrompt ?? personaPrompt ?? this.defaultSystemPrompt
      const memoryContextText = buildMemoryContextPrompt(request.memoryContext)
      const bondContextText = buildBondContextPrompt(request.bondContext)
      const budgetPlan = this.contextBudget.planner.plan({
        systemPrompt: baseSystemPrompt ?? '',
        personaContextText: undefined,
        memoryContextText,
        bondContextText,
        maxMemoryChars: this.contextBudget.maxMemoryChars,
        maxBondChars: this.contextBudget.maxBondChars,
        maxPersonaChars: this.contextBudget.maxPersonaChars,
        maxSystemPromptChars: this.contextBudget.maxSystemPromptChars,
        maxEstimatedTokens: this.contextBudget.maxEstimatedTokens,
        tokenEstimateRatio: this.contextBudget.tokenEstimateRatio,
      })
      const systemMessage = buildSystemMessage(budgetPlan.systemPrompt)

      const window = request.contextWindow ?? this.defaultContextWindow
      const messages = truncateMessages(request.messages, window)

      const gatewayMessages: DialogueMessage[] = []
      if (systemMessage) gatewayMessages.push(systemMessage)
      gatewayMessages.push(...messages)

      const capability: BrainCapability = request.capability ?? 'dialogue-generation'
      const resolvedSlot = request.slot ?? this.defaultModelSlot

      const gatewayResponse = await this.gateway.execute({
        task: request.task,
        lifeId: request.lifeId,
        habitatId: request.habitatId,
        slot: resolvedSlot,
        messages: gatewayMessages,
        metadata: {
          ...request.metadata,
          source: 'elysia-ai-brain',
          capability,
          personaName: persona?.name,
          personaTraits: persona?.traits,
          personaTone: persona?.tone,
          memoryContextItemCount: request.memoryContext?.items.length ?? 0,
          hasMemoryContext: Boolean(request.memoryContext?.items.length),
          memoryContextTruncated: budgetPlan.diagnostics.memoryContextTruncated,
          memoryContextPromptLength: budgetPlan.diagnostics.memoryContextFinalChars,
          memoryContextOriginalChars: budgetPlan.diagnostics.memoryContextOriginalChars,
          memoryContextFinalChars: budgetPlan.diagnostics.memoryContextFinalChars,
          bondContextItemCount: request.bondContext?.items.length ?? 0,
          hasBondContext: Boolean(request.bondContext?.items.length),
          bondContextTruncated: budgetPlan.diagnostics.bondContextTruncated,
          bondContextPromptLength: budgetPlan.diagnostics.bondContextFinalChars,
          bondContextOriginalChars: budgetPlan.diagnostics.bondContextOriginalChars,
          bondContextFinalChars: budgetPlan.diagnostics.bondContextFinalChars,
          personaContextOriginalChars: budgetPlan.diagnostics.personaContextOriginalChars,
          personaContextFinalChars: budgetPlan.diagnostics.personaContextFinalChars,
          personaContextTruncated: budgetPlan.diagnostics.personaContextTruncated,
          systemPromptTruncated: budgetPlan.diagnostics.systemPromptTruncated,
          systemPromptLength: budgetPlan.diagnostics.systemPromptFinalChars,
          systemPromptOriginalChars: budgetPlan.diagnostics.systemPromptOriginalChars,
          systemPromptFinalChars: budgetPlan.diagnostics.systemPromptFinalChars,
          contextBudgetStrategy: budgetPlan.diagnostics.strategy,
          estimatedSystemPromptTokens: budgetPlan.diagnostics.estimatedSystemPromptTokens,
          maxEstimatedTokens: budgetPlan.diagnostics.maxEstimatedTokens,
          tokenEstimateRatio: budgetPlan.diagnostics.tokenEstimateRatio,
        },
      })

      const response: BrainResponse = {
        output: gatewayResponse.output,
        messages: gatewayResponse.messages,
        capability,
        metadata: {
          ...gatewayResponse.metadata,
          provider: gatewayResponse.provider,
          usage: gatewayResponse.usage,
          source: 'elysia-ai-brain',
        },
      }

      await this.eventBus?.emit('brain.completed', { request, response })
      return response
    } catch (error) {
      await this.eventBus?.emit('brain.failed', { request, error })
      throw error
    }
  }
}

// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
// Plugin apply
// 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

type BrainLoggerLike = {
  info(...args: unknown[]): void
  debug?(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface BrainPluginRuntimeOptions {
  runtime: { context: { eventBus: EventBus<CoreEventMap> }, personaRegistry?: PersonaRegistry }
  modelGateway: ModelGatewayService
  config: Config
  logger: BrainLoggerLike
}

export interface BrainPluginRuntime {
  service: DefaultBrainService
  dispose(): void
}

export function createBrainPluginRuntime(options: BrainPluginRuntimeOptions): BrainPluginRuntime {
  const { runtime, modelGateway, config, logger } = options

  logger.info('brain plugin apply started', {
    plugin: 'elysia-ai-brain',
    phase: 'apply',
  })

  const service = new DefaultBrainService(config, modelGateway, runtime.context.eventBus, runtime.personaRegistry)

  logger.info('brain plugin ready', {
    plugin: 'elysia-ai-brain',
    phase: 'apply',
    hasSystemPrompt: Boolean(config.systemPrompt),
    contextWindow: config.contextWindow ?? 20,
    defaultModelSlot: config.defaultModelSlot,
    contextBudget: config.contextBudget,
  })

  return {
    service,
    dispose() {},
  }
}
