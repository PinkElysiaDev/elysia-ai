import type { Persona } from '@elysia-ai/core'
import { clampPercent, hasPersonaTrait } from '@elysia-ai/shared'
import type { StimulusSignal } from './types.js'

/**
 * 将 persona traits 转换为 behavior signal 的轻量修正。
 *
 * 当前阶段保持规则简单、可解释、可测试：
 * - 不改变原始 signal 结构
 * - 不直接决定 routing decision
 * - 只作为 life state 调整后的最后一层倾向修正
 */
export function applyPersonaToSignal(
  signal: StimulusSignal,
  persona?: Persona,
): StimulusSignal {
  if (!persona) return signal

  let responseNecessity = signal.responseNecessity
  let continuity = signal.continuity
  let directness = signal.directness
  let structuralDeterminability = signal.structuralDeterminability

  if (hasPersonaTrait(persona, ['温柔', 'gentle', 'caring', 'compassion'])) {
    responseNecessity += 8
    continuity += 5
  }

  if (hasPersonaTrait(persona, ['好奇', 'curious', 'curiosity', '探究'])) {
    responseNecessity += 6
    structuralDeterminability -= 5
  }

  if (hasPersonaTrait(persona, ['活泼', 'outgoing', 'extrovert', '开朗'])) {
    directness += 6
    responseNecessity += 5
  }

  if (hasPersonaTrait(persona, ['沉稳', 'calm', 'reserved', '内敛'])) {
    directness -= 4
    structuralDeterminability += 4
  }

  return {
    ...signal,
    directness: clampPercent(directness),
    continuity: clampPercent(continuity),
    responseNecessity: clampPercent(responseNecessity),
    structuralDeterminability: clampPercent(structuralDeterminability),
  }
}
