import type { Stimulus } from '@elysia-ai/core'

// ─────────────────────────────────────────────────
// 刺激文本提取
// ─────────────────────────────────────────────────

/**
 * 从刺激中提取文本内容：优先取 payload.content，其次 metadata.contentText，
 * 都没有则返回空串。perception / cognition 等层共用。
 */
export function extractTextFromStimulus(stimulus: Stimulus): string {
  if (typeof stimulus.payload?.content === 'string') {
    return stimulus.payload.content
  }
  if (typeof stimulus.metadata?.contentText === 'string') {
    return stimulus.metadata.contentText
  }
  return ''
}
