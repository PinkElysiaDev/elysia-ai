import { describe, expect, it } from 'vitest'
import type { Stimulus } from '@elysia-ai/core'
import { createConversationScopeKey, resolveConversationScope } from '../packages/@elysia-ai/shared/src/conversation-scope.js'

// P0-2 回归：会话 scope 的唯一派生实现位于 shared/conversation-scope。
// dialogue（写会话历史，task.scope → key）与 cognition（读侧）必须使用
// 完全一致的 scope 派生与 key 拼接规则，否则 conversationStore 两端
// key 对不上，"对话连续性"上下文会静默失效。
// （旧 behavior 的 resolveStimulusScope 委托实现已随触发器重构删除。）

function makeStimulus(overrides: Partial<Stimulus> = {}): Stimulus {
  return {
    id: 's1',
    type: 'message',
    habitatId: 'habitat-1',
    actorId: 'user-1',
    payload: { content: 'hi' },
    timestamp: Date.now(),
    ...overrides,
  } as Stimulus
}

describe('conversation scope 统一派生', () => {
  it('thread 消息：派生 thread scope，key 形如 life:thread:habitat:thread', () => {
    const stimulus = makeStimulus({ threadId: 't1', lifeId: 'life-1' })
    const scope = resolveConversationScope(stimulus)
    const key = createConversationScopeKey(stimulus.lifeId, scope)

    expect(scope).toEqual({ type: 'thread', key: 'habitat-1:t1' })
    expect(key).toBe('life-1:thread:habitat-1:t1')
  })

  it('无 thread 的用户消息：scope 退化为 user 维度', () => {
    const stimulus = makeStimulus({ lifeId: 'life-2' })
    const scope = resolveConversationScope(stimulus)
    const key = createConversationScopeKey('life-2', scope)

    expect(scope).toEqual({ type: 'user', key: 'habitat-1:user-1' })
    expect(key).toBe('life-2:user:habitat-1:user-1')
  })

  it('无 actor 的系统刺激：退化为 life-global', () => {
    const stimulus = makeStimulus({ type: 'system', actorId: undefined, lifeId: 'life-3' })
    const scope = resolveConversationScope(stimulus)
    const key = createConversationScopeKey('life-3', scope)

    expect(scope).toEqual({ type: 'life-global', key: 'life-global' })
    expect(key).toBe('life-3:life-global:life-global')
  })

  it('lifeId 缺失时以 global 兜底', () => {
    const stimulus = makeStimulus()
    expect(createConversationScopeKey(undefined, resolveConversationScope(stimulus)))
      .toBe('global:user:habitat-1:user-1')
  })
})
