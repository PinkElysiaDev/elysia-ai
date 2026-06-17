/**
 * R1 安全红线：observatory payload 脱敏字段覆盖（H3）
 *
 * 背景（见 docs/elysia-ai-review-2026-06.md，H3）：
 * 旧脱敏只摘要 `messages`(数组) 和 `content`(字符串)，
 * 漏掉 `summary / text / systemPrompt / prompt` 等承载自然语言的字段，
 * 以及数组形态的 `content`（Koishi 消息元素数组）。
 * 这会让完整 prompt / 记忆文本 / 系统提示词泄露进 observatory trace。
 */

import { describe, it, expect } from 'vitest'
import { DefaultObservatoryService } from '../packages/@elysia-ai/observatory/src/service.js'

function recordedMetadata(service: DefaultObservatoryService, event: string, payload: Record<string, unknown>) {
  service.recordEvent(event as any, payload)
  const recent = service.getRecentEvents(10)
  const found = recent.find((e: any) => e.event === event)
  return JSON.stringify(found?.metadata ?? {})
}

describe('R1 observatory 脱敏字段覆盖', () => {
  it('systemPrompt 不应原文出现在 trace', () => {
    const service = new DefaultObservatoryService()
    const serialized = recordedMetadata(service, 'brain.requested', {
      request: { systemPrompt: 'SECRET_SYSTEM_PROMPT_BODY_should_not_leak' },
    })
    expect(serialized).not.toContain('SECRET_SYSTEM_PROMPT_BODY_should_not_leak')
  })

  it('memory text / summary 不应原文出现在 trace', () => {
    const service = new DefaultObservatoryService()
    const serialized = recordedMetadata(service, 'memory.created', {
      entry: {
        text: 'PRIVATE_MEMORY_TEXT_should_not_leak',
        summary: 'PRIVATE_MEMORY_SUMMARY_should_not_leak',
      },
    })
    expect(serialized).not.toContain('PRIVATE_MEMORY_TEXT_should_not_leak')
    expect(serialized).not.toContain('PRIVATE_MEMORY_SUMMARY_should_not_leak')
  })

  it('数组形态的 content 不应逐元素泄露', () => {
    const service = new DefaultObservatoryService()
    const serialized = recordedMetadata(service, 'stimulus.received', {
      content: [
        { type: 'text', data: { content: 'ARRAY_CONTENT_ELEMENT_should_not_leak' } },
      ],
    })
    expect(serialized).not.toContain('ARRAY_CONTENT_ELEMENT_should_not_leak')
  })

  it('content 字符串仍按长度摘要（无回归）', () => {
    const service = new DefaultObservatoryService()
    service.recordEvent('stimulus.received' as any, { content: '你好世界' })
    const recent = service.getRecentEvents(10)
    const found = recent.find((e: any) => e.event === 'stimulus.received')
    const meta: any = found?.metadata
    expect(meta?.content).toEqual({ length: 4 })
  })

  it('apiKey/secret 仍被 redact（无回归）', () => {
    const service = new DefaultObservatoryService()
    const serialized = recordedMetadata(service, 'gateway.failed', {
      apiKey: 'sk-must-not-leak',
    })
    expect(serialized).not.toContain('sk-must-not-leak')
    expect(serialized).toContain('[Redacted]')
  })
})
