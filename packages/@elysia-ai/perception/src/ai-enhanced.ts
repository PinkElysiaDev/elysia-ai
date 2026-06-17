import type {
  BrainService,
  PerceptionResult,
  Stimulus,
} from '@elysia-ai/core'
import { parseAiJsonResponse, safeNumber } from '@elysia-ai/shared'
import type { PluginLogger } from '@elysia-ai/shared'
import type { Config } from './index.js'
import { analyzeStimulus, extractTextFromStimulus } from './rules.js'

// ─────────────────────────────────────────────────
// AI enhanced 条件判断
// ─────────────────────────────────────────────────

function shouldUseAiPerception(
  text: string,
  config: Config,
  brain?: BrainService,
): boolean {
  if (!config.aiEnhanced) return false
  if (!brain) return false
  return text.trim().length >= config.aiMinTextLength
}

// ─────────────────────────────────────────────────
// AI 结果解析与合并
// ─────────────────────────────────────────────────

function isSentimentLabel(value: unknown): value is PerceptionResult['sentiment']['label'] {
  return value === 'positive' || value === 'negative' || value === 'neutral'
}

function normalizeAiEntities(value: unknown): PerceptionResult['entities'] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entity) => {
    if (typeof entity !== 'object' || entity === null || Array.isArray(entity)) return []
    const record = entity as Record<string, unknown>
    if (typeof record.type !== 'string' || typeof record.value !== 'string') return []
    return [{
      type: record.type,
      value: record.value,
      confidence: safeNumber(record.confidence, 0.7),
    }]
  })
}

function mergeEntities(
  base: PerceptionResult['entities'],
  incoming: PerceptionResult['entities'],
): PerceptionResult['entities'] {
  const merged = [...base]
  for (const entity of incoming) {
    if (!merged.some((item) => item.type === entity.type && item.value === entity.value)) {
      merged.push(entity)
    }
  }
  return merged
}

function mergeAiResult(
  ruleBasedResult: PerceptionResult,
  aiPayload: Record<string, unknown>,
  aiMetadata: Record<string, unknown>,
): PerceptionResult {
  const aiIntent = aiPayload.intent as Record<string, unknown> | undefined
  const aiSentiment = aiPayload.sentiment as Record<string, unknown> | undefined

  const aiIntentPrimary = aiIntent?.primary
  const aiIntentConfidence = safeNumber(aiIntent?.confidence, 0)
  const aiEntities = normalizeAiEntities(aiPayload.entities)
  const aiSentimentLabel = aiSentiment?.label
  const aiSentimentConfidence = safeNumber(aiSentiment?.confidence, 0)

  const intent = typeof aiIntentPrimary === 'string' &&
    aiIntentConfidence > ruleBasedResult.intent.confidence
    ? { primary: aiIntentPrimary, confidence: aiIntentConfidence }
    : ruleBasedResult.intent

  const sentiment = isSentimentLabel(aiSentimentLabel) &&
    aiSentimentConfidence > ruleBasedResult.sentiment.confidence
    ? { label: aiSentimentLabel, confidence: aiSentimentConfidence }
    : ruleBasedResult.sentiment

  return {
    ...ruleBasedResult,
    intent,
    entities: mergeEntities(ruleBasedResult.entities, aiEntities),
    sentiment,
    metadata: {
      ...ruleBasedResult.metadata,
      ...aiMetadata,
      mode: 'ai-enhanced',
      aiRequested: true,
      aiSucceeded: true,
    },
  }
}

// ─────────────────────────────────────────────────
// AI prompt 构建
// ─────────────────────────────────────────────────

function createAiPrompt(stimulus: Stimulus, text: string): string {
  return JSON.stringify({
    instruction: 'Analyze the message and return JSON only. Do not include markdown or commentary.',
    schema: {
      intent: { primary: 'string', confidence: 'number between 0 and 1' },
      entities: [{ type: 'string', value: 'string', confidence: 'number between 0 and 1' }],
      sentiment: { label: 'positive | negative | neutral', confidence: 'number between 0 and 1' },
    },
    stimulus: {
      id: stimulus.id,
      type: stimulus.type,
      habitatId: stimulus.habitatId,
      actorId: stimulus.actorId,
      content: text,
    },
  })
}

// ─────────────────────────────────────────────────
// 主入口：规则分析 + 可选 AI 增强
// ─────────────────────────────────────────────────

export async function analyzeStimulusWithAi(
  stimulus: Stimulus,
  config: Config,
  brain: BrainService | undefined,
  logger: PluginLogger,
): Promise<PerceptionResult> {
  const text = extractTextFromStimulus(stimulus)
  const ruleBasedResult = analyzeStimulus(stimulus, config)

  if (!shouldUseAiPerception(text, config, brain)) {
    return ruleBasedResult
  }

  try {
    const response = await brain!.execute({
      task: 'perception-analysis',
      habitatId: stimulus.habitatId,
      capability: 'perception-analysis',
      slot: config.aiModelSlot || undefined,
      messages: [{
        role: 'user',
        content: createAiPrompt(stimulus, text),
        metadata: {
          source: 'elysia-ai-perception',
          stimulusId: stimulus.id,
        },
      }],
      metadata: {
        source: 'elysia-ai-perception',
        stimulusId: stimulus.id,
      },
    })

    const aiPayload = parseAiJsonResponse(response.output)
    if (!aiPayload) {
      throw new Error('AI perception returned invalid JSON payload')
    }

    return mergeAiResult(ruleBasedResult, aiPayload, {
      provider: response.metadata?.provider,
      usage: response.metadata?.usage,
    })
  } catch (error) {
    logger.error('ai perception failed', error, {
      plugin: 'elysia-ai-perception',
      phase: 'ai-perception',
      stimulusId: stimulus.id,
      fallback: config.aiFallbackToRuleBased,
    })

    if (!config.aiFallbackToRuleBased) throw error

    return {
      ...ruleBasedResult,
      metadata: {
        ...ruleBasedResult.metadata,
        mode: 'fallback-rule-based',
        aiRequested: true,
        aiSucceeded: false,
        errorSummary: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
