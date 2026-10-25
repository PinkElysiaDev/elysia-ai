/**
 * LLM 工具调用契约（brain / model-gateway 通道层）。
 *
 * 形状对齐 @elysia-ai/maheshvara 的 MaheshvaraTool / MaheshvaraToolCall
 * 子集；core 不直接依赖 maheshvara，由网关桥接层（maheshvara-bridge）
 * 负责双向映射，协议差异（如 anthropic 的 input_schema）在 encode 侧消化。
 */

/** 工具定义。parameters 为 JSON Schema（OpenAI 风格）。 */
export interface ToolDefinition {
  name: string
  description?: string
  /** JSON Schema 形式的参数定义 */
  parameters?: Record<string, unknown>
  strict?: boolean
}

/** 一次工具调用（assistant 侧产出）。 */
export interface ToolCall {
  id?: string
  type: string
  name?: string
  /** 已解析的 JSON 值或原始 JSON 字符串（协议间不一致，消费方用 parseToolCallArguments 归一） */
  arguments?: unknown
}

/**
 * 将 ToolCall.arguments 归一为对象：
 * 字符串则 JSON.parse（失败回退空对象），对象原样返回。
 */
export function parseToolCallArguments(call: ToolCall): Record<string, unknown> {
  return parseToolArgumentsValue(call.arguments)
}

/** arguments 原始值 → 对象 归一。 */
export function parseToolArgumentsValue(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'string') {
    if (raw.trim() === '') return {}
    try {
      const parsed: unknown = JSON.parse(raw)
      return isPlainObject(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isPlainObject(raw) ? raw : {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
