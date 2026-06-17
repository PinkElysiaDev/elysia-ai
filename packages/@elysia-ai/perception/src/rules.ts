import type {
  PerceptionContext,
  PerceptionResult,
  Stimulus,
} from '@elysia-ai/core'
import { extractTextFromStimulus } from '@elysia-ai/shared'
import type { Config } from './index.js'

// 自 @elysia-ai/shared 再导出，保持包内既有 import 路径不变
export { extractTextFromStimulus }

// ─────────────────────────────────────────────────
// Token 估算
// ─────────────────────────────────────────────────

function estimateTokenCount(text: string): number {
  const asciiLen = (text.match(/[\x00-\x7f]/g) ?? []).length
  const nonAsciiLen = text.length - asciiLen
  return Math.ceil(asciiLen / 4) + nonAsciiLen
}

// ─────────────────────────────────────────────────
// 意图识别
// ─────────────────────────────────────────────────

function extractIntent(text: string): PerceptionResult['intent'] {
  const lower = text.toLowerCase()
  // CJK 关键词不能用 \b 包裹：\b 是 ASCII 词边界，中文字符两侧不存在边界，
  // 会导致中文关键词永不命中。ASCII 关键词单独成组并保留 \b 以避免子串误命中。
  const patterns: Array<{ label: string; test: RegExp }> = [
    { label: 'greet', test: /(你好|嘿|嗨|哈喽|早上好|晚上好)|\b(hi|hello|good\s*morning|good\s*evening)\b/i },
    { label: 'farewell', test: /(再见|拜拜|晚安|下次见|回头见)|\b(bye|good\s*night)\b/i },
    { label: 'ask_opinion', test: /(你觉得|你怎么看|你认为|你感觉|你的看法|你怎么想)|\b(what\s*do\s*you\s*think|your\s*opinion)\b/i },
    { label: 'ask_fact', test: /(什么是|什么定义|解释一下|给我讲讲|告诉我)|\b(definition\s*of|explain|what\s*is)\b/i },
    { label: 'command', test: /(帮我|帮忙|给我一|请你|请我|能不能|可以吗|请告诉我|能帮)/i },
    { label: 'share_feeling', test: /(我好|我感觉|我心情|我有点|我特别|我很难|我开心|我难过)|\b(i\s*feel|i\s*am\s*(so|really|very))\b/i },
    { label: 'question', test: /\?|？|吗\s*$/ },
  ]

  for (const { label, test } of patterns) {
    if (test.test(lower)) return { primary: label, confidence: 0.6 }
  }

  return { primary: 'statement', confidence: 0.4 }
}

// ─────────────────────────────────────────────────
// 实体提取
// ─────────────────────────────────────────────────

function extractEntities(text: string): PerceptionResult['entities'] {
  const entities: PerceptionResult['entities'] = []

  const mentionRegex = /@(\S+)/g
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    if (!entities.some((e) => e.type === 'mention' && e.value === match![1])) {
      entities.push({ type: 'mention', value: match[1], confidence: 0.9 })
    }
  }

  const urlRegex = /https?:\/\/\S+/g
  while ((match = urlRegex.exec(text)) !== null) {
    if (!entities.some((e) => e.type === 'url' && e.value === match![0])) {
      entities.push({ type: 'url', value: match[0], confidence: 0.95 })
    }
  }

  const timeRegex = /\b(\d{1,2}[:：]\d{2}|今天|明天|昨天|刚才|刚刚|一会儿|马上|立刻|现在|上午|下午|晚上|凌晨)\b/g
  while ((match = timeRegex.exec(text)) !== null) {
    if (!entities.some((e) => e.type === 'time' && e.value === match![0])) {
      entities.push({ type: 'time', value: match[0], confidence: 0.7 })
    }
  }

  return entities
}

// ─────────────────────────────────────────────────
// 情感分析
// ─────────────────────────────────────────────────

function estimateSentiment(text: string): PerceptionResult['sentiment'] {
  const lower = text.toLowerCase()
  // 同 extractIntent：CJK 词不可用 \b 包裹。ASCII 词保留边界。
  // 使用全局标志 /g 真实统计命中次数——非全局 match 只返回首个匹配，
  // 计数恒为 0 或 1，无法反映情感强度。
  const positiveWords = /开心|高兴|喜欢|爱|太好了|棒|赞|厉害|666|哈哈|嘿嘿|\bnice\b|\bgreat\b|\bawesome\b|\blove\b|\bgood\b|\bhappy\b/gi
  const negativeWords = /难过|伤心|生气|讨厌|烦|糟糕|垃圾|傻|恶心|\bsad\b|\bangry\b|\bbad\b|\bhate\b|\bugly\b|\bawful\b|\bterrible\b/gi

  const posCount = (lower.match(positiveWords) ?? []).length
  const negCount = (lower.match(negativeWords) ?? []).length

  if (posCount > negCount) return { label: 'positive', confidence: Math.min(0.95, 0.55 + posCount * 0.05) }
  if (negCount > posCount) return { label: 'negative', confidence: Math.min(0.95, 0.55 + negCount * 0.05) }
  return { label: 'neutral', confidence: 0.5 }
}

// ─────────────────────────────────────────────────
// 规则版综合分析
// ─────────────────────────────────────────────────

export function analyzeStimulus(stimulus: Stimulus, config: Config): PerceptionResult {
  const text = extractTextFromStimulus(stimulus)
  const context: PerceptionContext = {
    stimulusId: stimulus.id,
    habitatId: stimulus.habitatId,
    actorId: stimulus.actorId,
    type: stimulus.type,
    tokenCount: estimateTokenCount(text),
  }

  return {
    stimulusId: stimulus.id,
    context,
    intent: config.enabledIntentClassify ? extractIntent(text) : { primary: 'unknown', confidence: 0 },
    entities: config.enabledEntityExtract ? extractEntities(text) : [],
    sentiment: config.enabledSentiment ? estimateSentiment(text) : { label: 'neutral', confidence: 0.5 },
    analyzedAt: Date.now(),
    metadata: {
      mode: 'rule-based',
      aiRequested: false,
      aiSucceeded: false,
    },
  }
}
