import { describe, expect, it, vi } from 'vitest'
import { CommandSystem, DEFAULT_INSTANT_RULES, InstantEngine, expandTemplate } from './index.js'
import type { CommandItem, InstantItem, TriggerEvent } from './index.js'

let now = 1_700_000_000_000

function messageEvent(content: string, overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    key: 'message',
    timestamp: now,
    habitatId: 'g1',
    actorId: 'u1',
    actorName: '小明',
    stimulusId: `s-${content}`,
    payload: { content },
    ...overrides,
  }
}

describe('CommandSystem（指令直达）', () => {
  const songCommand: CommandItem = {
    id: 'song',
    enabled: true,
    aliases: ['点歌', '来首'],
    permission: { mode: 'all' },
    cooldown: { globalMs: 0, perUserMs: 3_000 },
    action: { type: 'send-text', template: '已为你点播：{{content}}' },
  }

  function makeSystem(items: CommandItem[]) {
    return new CommandSystem({ getConfig: () => items, now: () => now })
  }

  it('别名前缀匹配 + 剩余文本作为 {{content}} 参数；长度优先防短别名抢匹配', () => {
    const executed: string[] = []
    const system = makeSystem([songCommand, {
      ...songCommand,
      id: 'song-special',
      aliases: ['点一首'],
      action: { type: 'send-text', template: '特殊点歌：{{content}}' },
    }])
    expect(system.handle(messageEvent('点歌 晴天'), (r) => executed.push(r.receipt ?? ''))).toBe(true)
    expect(executed[0]).toBe('已为你点播：晴天')
    expect(system.handle(messageEvent('点一首七里香'), (r) => executed.push(r.receipt ?? ''))).toBe(true)
    expect(executed[1]).toBe('特殊点歌：七里香')
  })

  it('非消息事件与未命中内容返回 false（事件下行）', () => {
    const system = makeSystem([songCommand])
    expect(system.handle({ ...messageEvent(''), key: 'member-added', payload: {} }, vi.fn())).toBe(false)
    expect(system.handle(messageEvent('今天天气不错'), vi.fn())).toBe(false)
  })

  it('uids 白名单外的用户不消费事件（模型可见）', () => {
    const system = makeSystem([{ ...songCommand, permission: { mode: 'uids', uids: ['vip'] } }])
    expect(system.handle(messageEvent('点歌 晴天', { actorId: 'u2' }), vi.fn())).toBe(false)
    expect(system.handle(messageEvent('点歌 晴天', { actorId: 'vip' }), vi.fn())).toBe(true)
  })

  it('冷却中不消费；冷却过期恢复', () => {
    const system = makeSystem([songCommand])
    expect(system.handle(messageEvent('点歌 A'), vi.fn())).toBe(true)
    now += 1_000
    expect(system.handle(messageEvent('点歌 B'), vi.fn())).toBe(false)  // 同人 3s 冷却
    now += 2_500
    expect(system.handle(messageEvent('点歌 C'), vi.fn())).toBe(true)
  })

  it('回执模板走 expandTemplate：{{user}} 展开，{{content}} 仍取参数文本', () => {
    const executed: string[] = []
    const system = makeSystem([{
      ...songCommand,
      aliases: ['点歌'],
      // {{content}} 与其他变量混排：{{user}} 应展开为 actorName，{{content}} 取 rest
      action: { type: 'send-text', template: '{{user}} 点了 {{content}}' },
    }])
    expect(system.handle(messageEvent('点歌 晴天'), (r) => executed.push(r.receipt ?? ''))).toBe(true)
    expect(executed[0]).toBe('小明 点了 晴天')
    // 无参指令：{{content}} 回退为别名本身（先出冷却窗）
    now += 4_000
    expect(system.handle(messageEvent('点歌'), (r) => executed.push(r.receipt ?? ''))).toBe(true)
    expect(executed[1]).toBe('小明 点了 点歌')
  })

  it('per-user 冷却记录容量上限 500：超限清最旧', () => {
    const system = makeSystem([{ ...songCommand, cooldown: { globalMs: 0, perUserMs: 60_000 } }])
    // 501 个不同用户各命中一次（插入序即冷却时间序）
    for (let i = 0; i <= 500; i++) {
      expect(system.handle(messageEvent('点歌 x', { actorId: `u${i}` }), vi.fn())).toBe(true)
    }
    // 最旧的用户 u0 已被逐出 → 冷却记录不命中，可再次执行
    expect(system.handle(messageEvent('点歌 x', { actorId: 'u0' }), vi.fn())).toBe(true)
    // 其余仍在冷却中
    expect(system.handle(messageEvent('点歌 x', { actorId: 'u250' }), vi.fn())).toBe(false)
    expect(system.handle(messageEvent('点歌 x', { actorId: 'u500' }), vi.fn())).toBe(false)
  })
})

describe('InstantEngine（即时应对）', () => {
  it('默认规则：mention / direct-message 命中 llm 动作', () => {
    const engine = new InstantEngine({ getConfig: () => DEFAULT_INSTANT_RULES, now: () => now })
    const mention = engine.match(messageEvent('@bot 你好', { key: 'mention' }))
    expect(mention?.item.id).toBe('mention-must-respond')
    expect(mention?.item.action).toEqual({ type: 'llm', directive: expect.any(String) })
    const dm = engine.match(messageEvent('在吗', { key: 'direct-message' }))
    expect(dm?.item.id).toBe('direct-message-must-respond')
    expect(engine.match(messageEvent('普通消息'))).toBeUndefined()
  })

  it('条件矩阵：同组 OR、跨组 AND、正则捕获组', () => {
    const rule: InstantItem = {
      id: 'r1', name: '关键词+白名单', enabled: true, eventKey: 'message',
      condition: { keywords: ['下雨', '天气'], regex: ['(\\d+)点'], uids: ['u1'] },
      action: { type: 'send-text', template: '{{user}} 问的是 {{match.1}} 点' },
      cooldownMs: 0,
    }
    const engine = new InstantEngine({ getConfig: () => [rule], now: () => now })
    // 关键词 + 正则 + 白名单全过
    const hit = engine.match(messageEvent('明天3点会下雨吗'))
    expect(hit).toBeDefined()
    expect(engine.expand(hit!.item.action as { template: string }, messageEvent('明天3点会下雨吗'), hit!.match))
      .toBe('小明 问的是 3 点')
    // 正则不命中 → 不匹配
    expect(engine.match(messageEvent('明天会下雨吗'))).toBeUndefined()
    // 白名单外 → 不匹配
    expect(engine.match(messageEvent('明天3点会下雨吗', { actorId: 'u9' }))).toBeUndefined()
  })

  it('非法正则不命中（防误触发）；每规则冷却独立', () => {
    const rule: InstantItem = {
      id: 'r2', name: '非法正则', enabled: true, eventKey: 'message',
      condition: { regex: ['(['] },
      action: { type: 'send-text', template: 'x' },
      cooldownMs: 5_000,
    }
    const engine = new InstantEngine({ getConfig: () => [rule], now: () => now })
    expect(engine.match(messageEvent('任意内容'))).toBeUndefined()
  })
})

describe('expandTemplate（模板变量）', () => {
  it('{{user}}/{{content}}/{{match.N}} 与未知变量保留', () => {
    const event = messageEvent('你好')
    expect(expandTemplate('{{user}} 说 {{content}}', event)).toBe('小明 说 你好')
    expect(expandTemplate('{{unknown}}', event)).toBe('{{unknown}}')
  })
})
