import type {
  BrainService,
  CognitionContext,
  CognitionResult,
  ConversationEntry,
} from '@elysia-ai/core'
import { parseAiJsonResponse, safeNumber } from '@elysia-ai/shared'
import type { PluginLogger } from '@elysia-ai/shared'
import type { Config } from './index.js'
import { extractTextFromStimulus, estimateSalience } from './salience.js'
import { buildReason, buildSummary } from './reason.js'

// ─────────────────────────────────────────────────
// Continuity 估算
// ─────────────────────────────────────────────────

function estimateContinuity(text: string, recentConversation: ConversationEntry[]): number {
  if (recentConversation.length === 0) return 0

  const normalized = text.trim().toLowerCase()
  if (!normalized) return 0

  const recentText = recentConversation
    .slice(-4)
    .map((entry) => entry.content.toLowerCase())
    .join('\n')

  const keywords = normalized
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 12)

  if (keywords.length === 0) return 0.2

  const matched = keywords.filter((word) => recentText.includes(word)).length
  return Math.min(1, matched / keywords.length + Math.min(0.3, recentConversation.length / 40))
}

// ─────────────────────────────────────────────────
// 规则版认知推理
// ─────────────────────────────────────────────────

export function reasonAboutContext(context: CognitionContext, config: Config): CognitionResult {
  const text = extractTextFromStimulus(context.stimulus)
  const salience = estimateSalience(
    context.stimulus, text, config,
    context.perception, context.homeostasis, context.persona,
  )
  const continuity = estimateContinuity(text, context.recentConversation)
  const score = Math.max(salience, (salience + continuity) / 2)
  const shouldEnterBehavior = score >= config.behaviorThreshold

  return {
    stimulusId: context.stimulusId,
    lifeId: context.lifeId,
    scopeKey: context.scopeKey,
    summary: buildSummary(context.stimulus, text),
    salience,
    continuity,
    shouldEnterBehavior,
    reason: buildReason(shouldEnterBehavior, context.stimulus, context.perception, context.homeostasis, continuity),
    createdAt: Date.now(),
    metadata: {
      mode: 'rule-based',
      aiRequested: false,
      aiSucceeded: false,
      score,
      recentConversationCount: context.recentConversation.length,
      hasPersona: Boolean(context.persona),
      perceptionIntent: context.perception?.intent.primary,
      perceptionSentiment: context.perception?.sentiment.label,
      perceptionSentimentConfidence: context.perception?.sentiment.confidence,
      homeostasisEnergy: context.homeostasis?.energy,
      homeostasisSociability: context.homeostasis?.sociability,
      homeostasisMood: context.homeostasis?.mood,
    },
  }
}

// ─────────────────────────────────────────────────
// AI enhanced cognition
// ─────────────────────────────────────────────────

function shouldUseAiCognition(
  ruleResult: CognitionResult,
  config: Config,
  brain?: BrainService,
): boolean {
  if (!config.aiEnhanced) return false
  if (!brain) return false
  return ruleResult.salience >= config.aiMinSalience
}

function createAiPrompt(context: CognitionContext, ruleResult: CognitionResult): string {
  const text = extractTextFromStimulus(context.stimulus)
  return JSON.stringify({
    instruction: 'Analyze the cognitive context and return JSON only. Do not include markdown or commentary.',
    schema: {
      summary: 'string (max 200 chars)',
      salience: 'number 0-1',
      continuity: 'number 0-1',
      shouldEnterBehavior: 'boolean',
      reason: 'string',
    },
    stimulus: {
      id: context.stimulus.id,
      type: context.stimulus.type,
      content: text.slice(0, 500),
      actorId: context.stimulus.actorId,
      isMentioned: context.stimulus.isMentioned,
      isDirectMessage: context.stimulus.isDirectMessage,
    },
    perception: context.perception ? {
      intent: context.perception.intent,
      sentiment: context.perception.sentiment,
      entityCount: context.perception.entities.length,
    } : undefined,
    homeostasis: context.homeostasis ? {
      energy: context.homeostasis.energy,
      mood: context.homeostasis.mood,
      sociability: context.homeostasis.sociability,
      curiosity: context.homeostasis.curiosity,
    } : undefined,
    persona: context.persona ? {
      name: context.persona.name,
      traits: context.persona.traits,
      tone: context.persona.tone,
    } : undefined,
    recentConversationCount: context.recentConversation.length,
    ruleBasedResult: {
      salience: ruleResult.salience,
      continuity: ruleResult.continuity,
      shouldEnterBehavior: ruleResult.shouldEnterBehavior,
    },
  })
}

function mergeAiResult(
  ruleResult: CognitionResult,
  aiPayload: Record<string, unknown>,
  aiMetadata: Record<string, unknown>,
  config: Config,
): CognitionResult {
  const ruleWeight = 0.6
  const aiWeight = 0.4

  const aiSalience = safeNumber(aiPayload.salience, ruleResult.salience)
  const aiContinuity = safeNumber(aiPayload.continuity, ruleResult.continuity)
  const aiShouldEnter = typeof aiPayload.shouldEnterBehavior === 'boolean'
    ? aiPayload.shouldEnterBehavior
    : ruleResult.shouldEnterBehavior

  const mergedSalience = ruleResult.salience * ruleWeight + aiSalience * aiWeight
  const mergedContinuity = ruleResult.continuity * ruleWeight + aiContinuity * aiWeight
  const mergedScore = Math.max(mergedSalience, (mergedSalience + mergedContinuity) / 2)

  const shouldEnterBehavior =
    ruleResult.shouldEnterBehavior ||
    (aiShouldEnter && mergedScore >= config.behaviorThreshold)

  const aiSummary = typeof aiPayload.summary === 'string' && aiPayload.summary.trim()
    ? aiPayload.summary.trim().slice(0, 240)
    : undefined
  const aiReason = typeof aiPayload.reason === 'string' && aiPayload.reason.trim()
    ? aiPayload.reason.trim()
    : undefined

  return {
    ...ruleResult,
    salience: mergedSalience,
    continuity: mergedContinuity,
    shouldEnterBehavior,
    summary: aiSummary ?? ruleResult.summary,
    reason: aiReason ? `rule: ${ruleResult.reason}; ai: ${aiReason}` : ruleResult.reason,
    metadata: {
      ...ruleResult.metadata,
      ...aiMetadata,
      mode: 'ai-enhanced',
      aiRequested: true,
      aiSucceeded: true,
      ruleWeight,
      aiWeight,
      mergedScore,
      ruleSalience: ruleResult.salience,
      aiSalience,
      ruleContinuity: ruleResult.continuity,
      aiContinuity,
    },
  }
}

export async function reasonWithAi(
  context: CognitionContext,
  config: Config,
  brain: BrainService | undefined,
  logger: PluginLogger,
): Promise<CognitionResult> {
  const ruleResult = reasonAboutContext(context, config)

  if (!shouldUseAiCognition(ruleResult, config, brain)) {
    return ruleResult
  }

  try {
    const response = await brain!.execute({
      task: 'cognition-reasoning',
      lifeId: context.lifeId,
      habitatId: context.habitatId,
      capability: 'cognition-reasoning',
      slot: config.aiModelSlot || undefined,
      messages: [{
        role: 'user',
        content: createAiPrompt(context, ruleResult),
        metadata: {
          source: 'elysia-ai-cognition',
          stimulusId: context.stimulusId,
          lifeId: context.lifeId,
        },
      }],
      metadata: {
        source: 'elysia-ai-cognition',
        stimulusId: context.stimulusId,
        lifeId: context.lifeId,
      },
    })

    const aiPayload = parseAiJsonResponse(response.output)
    if (!aiPayload) {
      throw new Error('AI cognition returned invalid JSON payload')
    }

    return mergeAiResult(ruleResult, aiPayload, {
      provider: response.metadata?.provider,
      usage: response.metadata?.usage,
    }, config)
  } catch (error) {
    logger.error('ai cognition failed', error, {
      plugin: 'elysia-ai-cognition',
      phase: 'ai-cognition',
      stimulusId: context.stimulusId,
      lifeId: context.lifeId,
      fallback: config.aiFallbackToRuleBased,
    })

    if (!config.aiFallbackToRuleBased) throw error

    return {
      ...ruleResult,
      metadata: {
        ...ruleResult.metadata,
        mode: 'fallback-rule-based',
        aiRequested: true,
        aiSucceeded: false,
        errorSummary: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
