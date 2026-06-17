/**
 * R1 回归红线：感知层中文主路径
 *
 * 这组测试编码 perception 规则层对“中文优先”定位的正确行为：
 * 中文意图与情感必须能被规则路径识别，而不依赖 AI enhanced。
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md，H1/H2）：
 * 旧实现用 `\b(...)\b` 包裹 CJK 关键词，`\b` 仅在 ASCII 词边界匹配，
 * 对“你好”“难过”等纯中文永不命中；情感计数用单次 match 恒为 0 或 1。
 * 这组测试在修复前应失败，修复后转绿。
 */

import { describe, it, expect } from 'vitest'
import { analyzeStimulus } from '../packages/@elysia-ai/perception/src/rules.js'
import type { Config } from '../packages/@elysia-ai/perception/src/index.js'
import type { Stimulus } from '../packages/@elysia-ai/core/src/index.js'

const config: Config = {
  maxInputTokens: 8192,
  enabledIntentClassify: true,
  enabledEntityExtract: true,
  enabledSentiment: true,
  aiEnhanced: false,
  aiFallbackToRuleBased: true,
  aiMinTextLength: 12,
  aiModelSlot: '',
}

function stim(content: string): Stimulus {
  return {
    id: 'r1-' + Math.random().toString(36).slice(2, 8),
    type: 'utterance',
    timestamp: Date.now(),
    habitatId: 'habitat-1',
    actorId: 'actor-1',
    payload: { content },
  }
}

describe('R1 perception 中文意图识别', () => {
  it('识别中文问候为 greet', () => {
    const result = analyzeStimulus(stim('你好呀'), config)
    expect(result.intent.primary).toBe('greet')
  })

  it('识别中文告别为 farewell', () => {
    const result = analyzeStimulus(stim('那我先下了，拜拜'), config)
    expect(result.intent.primary).toBe('farewell')
  })

  it('识别中文征询意见为 ask_opinion', () => {
    const result = analyzeStimulus(stim('你觉得这样做对吗'), config)
    expect(result.intent.primary).toBe('ask_opinion')
  })

  it('识别中文请求为 command', () => {
    const result = analyzeStimulus(stim('帮我查一下天气'), config)
    expect(result.intent.primary).toBe('command')
  })

  it('英文 greeting 仍然识别为 greet（无回归）', () => {
    const result = analyzeStimulus(stim('hello there'), config)
    expect(result.intent.primary).toBe('greet')
  })
})

describe('R1 perception 中文情感分析', () => {
  it('中文负面情感识别为 negative', () => {
    const result = analyzeStimulus(stim('我今天好难过，心情很糟糕'), config)
    expect(result.sentiment.label).toBe('negative')
  })

  it('中文正面情感识别为 positive', () => {
    const result = analyzeStimulus(stim('太好了，我好开心好喜欢'), config)
    expect(result.sentiment.label).toBe('positive')
  })

  it('多个正面词使置信度高于单个词', () => {
    const single = analyzeStimulus(stim('还不错吧'), config)
    const many = analyzeStimulus(stim('开心 高兴 喜欢 棒 赞'), config)
    expect(many.sentiment.label).toBe('positive')
    // 计数应真实累加：多词置信度应高于中性基线 0.5
    expect(many.sentiment.confidence).toBeGreaterThan(0.6)
    expect(many.sentiment.confidence).toBeGreaterThan(single.sentiment.confidence)
  })

  it('中性文本保持 neutral', () => {
    const result = analyzeStimulus(stim('今天是星期三'), config)
    expect(result.sentiment.label).toBe('neutral')
  })
})
