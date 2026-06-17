import type {
  HomeostasisState,
  PerceptionResult,
  Stimulus,
} from '@elysia-ai/core'

// ─────────────────────────────────────────────────
// Reason 构建（可解释性）
// ─────────────────────────────────────────────────

export function buildReason(
  shouldEnterBehavior: boolean,
  stimulus: Stimulus,
  perception?: PerceptionResult,
  homeostasis?: HomeostasisState,
  continuity?: number,
): string {
  const reasons: string[] = []

  if (stimulus.isMentioned) reasons.push('directly mentioned')
  if (stimulus.isDirectMessage) reasons.push('direct message')
  if (stimulus.isReply) reasons.push('reply to bot')
  if (stimulus.type === 'addressing') reasons.push('addressing type')

  if (perception) {
    if (perception.intent.primary === 'share_feeling') reasons.push('user sharing feelings')
    if (perception.intent.primary === 'command') reasons.push('user command')
    if (perception.intent.primary === 'ask_opinion') reasons.push('user asking opinion')
    if (perception.sentiment.label === 'negative') reasons.push('negative sentiment')
  }

  if (continuity !== undefined && continuity > 0.5) reasons.push('high conversation continuity')

  if (homeostasis) {
    if (homeostasis.energy < 0.25) reasons.push('low energy')
    if (homeostasis.sociability < 0.3) reasons.push('low sociability')
  }

  const detail = reasons.length > 0 ? reasons.join('; ') : 'no notable signals'

  return shouldEnterBehavior
    ? `entered behavior: ${detail}`
    : `skipped: ${detail}`
}

export function buildSummary(stimulus: Stimulus, text: string): string {
  if (text.trim()) {
    return text.trim().slice(0, 240)
  }
  return `[${stimulus.type}] stimulus from ${stimulus.actorId ?? 'unknown actor'}`
}
