export interface ContextBudgetPlanInput {
  systemPrompt: string
  memoryContextText?: string
  bondContextText?: string
  personaContextText?: string
  maxMemoryChars?: number
  maxBondChars?: number
  maxPersonaChars?: number
  maxSystemPromptChars?: number
  maxEstimatedTokens?: number
  tokenEstimateRatio?: number
}

export interface ContextBudgetDiagnostics {
  strategy: string
  tokenEstimateRatio: number
  maxEstimatedTokens?: number
  memoryContextOriginalChars: number
  memoryContextFinalChars: number
  memoryContextTruncated: boolean
  bondContextOriginalChars: number
  bondContextFinalChars: number
  bondContextTruncated: boolean
  personaContextOriginalChars: number
  personaContextFinalChars: number
  personaContextTruncated: boolean
  systemPromptOriginalChars: number
  systemPromptFinalChars: number
  systemPromptTruncated: boolean
  estimatedSystemPromptTokens: number
}

export interface ContextBudgetPlan {
  systemPrompt: string
  memoryContextText?: string
  bondContextText?: string
  personaContextText?: string
  diagnostics: ContextBudgetDiagnostics
}

export interface ContextBudgetPlanner {
  plan(input: ContextBudgetPlanInput): ContextBudgetPlan
}

interface TruncateResult {
  text?: string
  truncated: boolean
  originalChars: number
  finalChars: number
}

const TRUNCATION_SUFFIX = '\n[Context truncated by Elysia A.I. budget governance]'

function truncateText(text: string | undefined, maxChars: number | undefined): TruncateResult {
  if (!text) {
    return {
      text: undefined,
      truncated: false,
      originalChars: 0,
      finalChars: 0,
    }
  }

  if (!maxChars || maxChars <= 0 || text.length <= maxChars) {
    return {
      text,
      truncated: false,
      originalChars: text.length,
      finalChars: text.length,
    }
  }

  const slicedLength = Math.max(0, maxChars - TRUNCATION_SUFFIX.length)
  const truncated = `${text.slice(0, slicedLength)}${TRUNCATION_SUFFIX}`
  return {
    text: truncated,
    truncated: true,
    originalChars: text.length,
    finalChars: truncated.length,
  }
}

function estimateTokens(text: string, tokenEstimateRatio: number): number {
  return Math.ceil(text.length / tokenEstimateRatio)
}

function normalizeTokenEstimateRatio(value: number | undefined): number {
  if (!value || value <= 0 || Number.isNaN(value)) return 4
  return value
}

export class DefaultContextBudgetPlanner implements ContextBudgetPlanner {
  plan(input: ContextBudgetPlanInput): ContextBudgetPlan {
    const tokenEstimateRatio = normalizeTokenEstimateRatio(input.tokenEstimateRatio)
    const persona = truncateText(input.personaContextText, input.maxPersonaChars)
    const memory = truncateText(input.memoryContextText, input.maxMemoryChars)
    const bond = truncateText(input.bondContextText, input.maxBondChars)
    const combinedSystemPrompt = [
      input.systemPrompt,
      persona.text,
      memory.text,
      bond.text,
    ].filter(Boolean).join('\n\n')
    const systemPrompt = truncateText(combinedSystemPrompt, input.maxSystemPromptChars)

    return {
      systemPrompt: systemPrompt.text ?? '',
      personaContextText: persona.text,
      memoryContextText: memory.text,
      bondContextText: bond.text,
      diagnostics: {
        strategy: 'char-estimate-v1',
        tokenEstimateRatio,
        maxEstimatedTokens: input.maxEstimatedTokens,
        personaContextOriginalChars: persona.originalChars,
        personaContextFinalChars: persona.finalChars,
        personaContextTruncated: persona.truncated,
        memoryContextOriginalChars: memory.originalChars,
        memoryContextFinalChars: memory.finalChars,
        memoryContextTruncated: memory.truncated,
        bondContextOriginalChars: bond.originalChars,
        bondContextFinalChars: bond.finalChars,
        bondContextTruncated: bond.truncated,
        systemPromptOriginalChars: systemPrompt.originalChars,
        systemPromptFinalChars: systemPrompt.finalChars,
        systemPromptTruncated: systemPrompt.truncated,
        estimatedSystemPromptTokens: estimateTokens(systemPrompt.text ?? '', tokenEstimateRatio),
      },
    }
  }
}
