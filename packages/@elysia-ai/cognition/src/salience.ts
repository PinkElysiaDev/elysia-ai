import type {
  HomeostasisState,
  PerceptionResult,
  Persona,
  Stimulus,
} from '@elysia-ai/core'
import { extractTextFromStimulus, hasPersonaTrait } from '@elysia-ai/shared'
import type { Config } from './index.js'

// 自 @elysia-ai/shared 再导出，保持包内既有 import 路径不变
export { extractTextFromStimulus }

// ─────────────────────────────────────────────────
// Salience 计算（消费 perception / homeostasis / persona）
// ─────────────────────────────────────────────────

export function estimateSalience(
  stimulus: Stimulus,
  text: string,
  config: Config,
  perception?: PerceptionResult,
  homeostasis?: HomeostasisState,
  persona?: Persona,
): number {
  let salience = 0.1

  // 结构信号
  if (stimulus.isMentioned) salience += config.salienceDirectMentionBonus
  if (stimulus.isDirectMessage) salience += config.salienceDirectMessageBonus
  if (stimulus.isReply) salience += config.salienceReplyBonus
  if (/[?？]\s*$/.test(text)) salience += config.salienceQuestionBonus

  salience += Math.min(0.25, text.length * config.salienceLengthFactor)

  if (stimulus.type === 'addressing') salience += 0.15
  if (stimulus.type === 'system') salience -= 0.1
  if (!text.trim()) salience -= 0.15

  // 消费 perception 结果
  if (perception) {
    const intent = perception.intent.primary
    if (intent === 'share_feeling') salience += 0.12
    if (intent === 'ask_opinion') salience += 0.10
    if (intent === 'command') salience += 0.08
    if (intent === 'ask_fact') salience += 0.06

    if (perception.sentiment.label === 'negative') salience += 0.10
    if (perception.sentiment.label === 'positive') salience += 0.04
    if (perception.sentiment.confidence >= 0.8) salience += 0.04
  }

  // 消费 homeostasis 状态
  if (homeostasis) {
    if (homeostasis.sociability > 0.6) salience += 0.06
    if (homeostasis.sociability < 0.3) salience -= 0.06
    if (homeostasis.energy < 0.25) salience -= 0.08
    if (homeostasis.curiosity > 0.7) salience += 0.04
    if (homeostasis.mood < 0.3) salience -= 0.04
  }

  // 消费 persona traits
  if (persona) {
    if (hasPersonaTrait(persona, ['温柔', 'gentle', 'caring', 'compassion'])) {
      if (perception?.sentiment.label === 'negative') salience += 0.06
    }
    if (hasPersonaTrait(persona, ['好奇', 'curious', 'curiosity', '探究'])) {
      if (/[?？]/.test(text) || perception?.intent.primary === 'question') salience += 0.05
    }
    if (hasPersonaTrait(persona, ['活泼', 'outgoing', 'extrovert', '开朗'])) {
      salience += 0.03
    }
    if (hasPersonaTrait(persona, ['沉稳', 'calm', 'reserved', '内敛'])) {
      salience -= 0.03
    }
  }

  return Math.max(0, Math.min(1, salience))
}
