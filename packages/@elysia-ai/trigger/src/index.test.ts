import { describe, expect, it } from 'vitest'
import type { Stimulus } from '@elysia-ai/core'
import {
  AdaptiveBatcher,
  EventHistory,
  EventsPackMemory,
  formatEventFeedLine,
  isBatchableEventKey,
  isEventEnabled,
  isFeedIncluded,
  isSystemEventKey,
  stimulusToTriggerEvent,
} from './index.js'

function stimulus(overrides: Partial<Stimulus> = {}): Stimulus {
  return {
    id: 's1',
    type: 'utterance',
    timestamp: 1_700_000_000_000,
    habitatId: 'g1',
    actorId: 'u1',
    payload: { content: '今天天气不错' },
    ...overrides,
  }
}

describe('stimulusToTriggerEvent（目录化派生）', () => {
  it('utterance 按结构化特征优先级映射：DM > mention > reply > message', () => {
    expect(stimulusToTriggerEvent(stimulus())?.key).toBe('message')
    expect(stimulusToTriggerEvent(stimulus({ isDirectMessage: true }))?.key).toBe('direct-message')
    expect(stimulusToTriggerEvent(stimulus({ isDirectMessage: true, isMentioned: true }))?.key).toBe('direct-message')
    expect(stimulusToTriggerEvent(stimulus({ isMentioned: true }))?.key).toBe('mention')
    expect(stimulusToTriggerEvent(stimulus({ isReply: true }))?.key).toBe('reply')
  })

  it('addressing 视为 mention；appearance/reaction/system 按 payload.eventKind', () => {
    expect(stimulusToTriggerEvent(stimulus({ type: 'addressing' }))?.key).toBe('mention')
    expect(stimulusToTriggerEvent(stimulus({ type: 'appearance', payload: { eventKind: 'member-added' } }))?.key).toBe('member-added')
    expect(stimulusToTriggerEvent(stimulus({ type: 'reaction', payload: { eventKind: 'reaction', emoji: '👍' } }))?.key).toBe('reaction')
    expect(stimulusToTriggerEvent(stimulus({ type: 'system', payload: { eventKind: 'bot-sent', content: '你好' } }))?.key).toBe('bot-sent')
  })

  it('未登记 eventKind 与 silence 返回 null', () => {
    expect(stimulusToTriggerEvent(stimulus({ type: 'appearance', payload: {} }))).toBeNull()
    expect(stimulusToTriggerEvent(stimulus({ type: 'appearance', payload: { eventKind: 'nope' } }))).toBeNull()
    expect(stimulusToTriggerEvent(stimulus({ type: 'silence' }))).toBeNull()
  })

  it('actorName 从 payload / metadata 提取；feed 行渲染', () => {
    const event = stimulusToTriggerEvent(stimulus({ payload: { content: '在吗', actorName: '小明' } }))
    expect(event?.actorName).toBe('小明')
    expect(formatEventFeedLine(event!)).toMatch(/^\[\d{2}:\d{2}:\d{2}\] 消息 \| 小明: 在吗$/)

    const unnamed = stimulusToTriggerEvent(stimulus({ actorId: 'u9', payload: { content: '哈喽' } }))
    expect(formatEventFeedLine(unnamed!)).toContain('u9: 哈喽')
  })
})

describe('事件开关两层语义', () => {
  it('接收与呈现独立覆写，缺省走目录默认', () => {
    expect(isEventEnabled('message', {})).toBe(true)
    expect(isEventEnabled('message', { enabledEvents: { message: false } })).toBe(false)
    expect(isFeedIncluded('system.trigger.fired', {})).toBe(false)
    expect(isFeedIncluded('system.trigger.fired', { feedInclude: { 'system.trigger.fired': true } })).toBe(true)
  })

  it('分组判定：message/social 可合并，system 只进清单', () => {
    expect(isBatchableEventKey('message')).toBe(true)
    expect(isBatchableEventKey('member-added')).toBe(true)
    expect(isBatchableEventKey('bot-sent')).toBe(false)
    expect(isSystemEventKey('bot-sent')).toBe(true)
    expect(isSystemEventKey('message')).toBe(false)
  })
})

describe('EventHistory（滚动窗口 + feed 构建）', () => {
  it('窗口与条数双重淘汰', () => {
    const history = new EventHistory({ maxEvents: 3, windowMs: 60_000 })
    const base = 1_700_000_000_000
    for (let i = 0; i < 5; i++) {
      history.record({ key: 'message', timestamp: base + i * 1000, habitatId: 'g1', payload: { content: `m${i}` } })
    }
    expect(history.size()).toBe(3)
    // 时间窗淘汰：事件时间倒退 2 分钟，旧事件被清出
    history.record({ key: 'message', timestamp: base + 300_000, habitatId: 'g1', payload: {} })
    expect(history.size()).toBe(1)
  })

  it('feed 构建先取余量过滤再截尾（vtuber 双层截断）', () => {
    const history = new EventHistory()
    const base = 1_700_000_000_000
    for (let i = 0; i < 6; i++) {
      history.record({ key: 'message', timestamp: base + i * 1000, habitatId: 'g1', payload: { content: `m${i}` } })
      history.record({ key: 'system.trigger.fired', timestamp: base + i * 1000 + 500, habitatId: 'g1', payload: {} })
    }
    // 默认 trigger.fired 不进清单：12 条事件只剩 6 条消息
    const lines = history.buildFeedLines({ maxEvents: 10 })
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain('m0')
    // maxEvents 截尾保留最新
    const limited = history.buildFeedLines({ maxEvents: 2 })
    expect(limited).toHaveLength(2)
    expect(limited[1]).toContain('m5')
  })
})

describe('AdaptiveBatcher（四路径触发）', () => {
  function makeBatcher(config: Partial<import('./batcher.js').BatcherConfig>, onFire: (fire: import('./batcher.js').BatchFire) => void) {
    let current: import('./batcher.js').BatcherConfig = { enabled: true, quietWindowMs: 8000, maxWaitMs: 30000, densityWindowMs: 10000, densityThreshold: 15, maxBatch: 50, ...config }
    return new AdaptiveBatcher({
      getConfig: () => current,
      shouldCollect: (event) => isBatchableEventKey(event.key),
      onFire,
      now: () => currentTime,
    })
  }

  let currentTime = 1_700_000_000_000

  function eventAt(offset: number, key = 'message') {
    return { key, timestamp: currentTime + offset, habitatId: 'g1', payload: {} }
  }

  it('quiet：静默窗口到期触发', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({}, (fire) => fires.push(fire))
    batcher.push(eventAt(0))
    currentTime += 1_000
    batcher.push(eventAt(0))
    batcher.tick()
    expect(fires).toHaveLength(0)
    currentTime += 8_000
    batcher.tick()
    expect(fires).toHaveLength(1)
    expect(fires[0].reason).toBe('quiet')
    expect(fires[0].events).toHaveLength(2)
    // 触发后批清空，重复 tick 不再触发
    batcher.tick()
    expect(fires).toHaveLength(1)
  })

  it('density：窗口内事件数达标立即触发（不干等静默）', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({ densityThreshold: 3 }, (fire) => fires.push(fire))
    batcher.push(eventAt(0))
    batcher.push(eventAt(500))
    expect(fires).toHaveLength(0)
    batcher.push(eventAt(900))
    expect(fires).toHaveLength(1)
    expect(fires[0].reason).toBe('density')
  })

  it('density 窗口滚动：旧事件滑出后不计入', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({ densityThreshold: 3, densityWindowMs: 1000 }, (fire) => fires.push(fire))
    batcher.push(eventAt(0))
    batcher.push(eventAt(200))
    currentTime += 2000
    batcher.push(eventAt(0))
    expect(fires).toHaveLength(0)  // 前两条已滑出窗口
    batcher.push(eventAt(100))
    batcher.push(eventAt(200))
    expect(fires).toHaveLength(1)
  })

  it('max-wait：批龄封顶必发', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({ quietWindowMs: 60_000, maxWaitMs: 30_000 }, (fire) => fires.push(fire))
    batcher.push(eventAt(0))
    currentTime += 10_000
    batcher.push(eventAt(0))
    currentTime += 20_100
    batcher.tick()
    expect(fires).toHaveLength(1)
    expect(fires[0].reason).toBe('max-wait')
  })

  it('max-batch：单批条数达上限立即触发', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({ maxBatch: 2 }, (fire) => fires.push(fire))
    batcher.push(eventAt(0))
    batcher.push(eventAt(1))
    expect(fires).toHaveLength(1)
    expect(fires[0].reason).toBe('max-batch')
  })

  it('系统事件不进批（shouldCollect 谓词）；enabled=false 时清批', () => {
    currentTime = 1_700_000_000_000
    const fires: import('./batcher.js').BatchFire[] = []
    const batcher = makeBatcher({ maxBatch: 2 }, (fire) => fires.push(fire))
    batcher.push(eventAt(0, 'bot-sent'))
    batcher.push(eventAt(1, 'message'))
    expect(fires).toHaveLength(0)
    expect(batcher.pending().count).toBe(1)
  })
})

describe('EventsPackMemory（短期记忆）', () => {
  it('环形淘汰 + 渲染', () => {
    const memory = new EventsPackMemory({ maxPacks: 3 })
    const base = 1_700_000_000_000
    for (let i = 0; i < 5; i++) {
      memory.record({
        firedAt: base + i * 60_000,
        source: 'batcher',
        reason: 'quiet',
        events: [
          { key: 'message', timestamp: base + i * 60_000, habitatId: 'g1', actorName: `用户${i}`, payload: { content: `话${i}` } },
        ],
      })
    }
    expect(memory.size()).toBe(3)
    const recent = memory.recent(2)
    expect(recent[0].events[0].actorName).toBe('用户3')
    expect(recent[1].events[0].actorName).toBe('用户4')

    const rendered = memory.renderEntry(recent[1], { maxLines: 5 })
    expect(rendered).toContain('事件密度触发（quiet，1 条事件）')
    expect(rendered).toContain('用户4: 话4')
  })
})
