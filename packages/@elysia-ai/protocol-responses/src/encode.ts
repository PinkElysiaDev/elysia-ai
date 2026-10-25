/**
 * maheshvara → OpenAI Responses API wire 请求构造。
 * 对齐 maheshvara_convert.go 的 MaheshvaraToResponsesRequest / maheshvaraInputToResponses /
 * maheshvaraToolCallsToResponsesItems / maheshvaraContentToResponsesInputContent /
 * maheshvaraToolsToResponses / maheshvaraResponseFormatToResponses。
 */

import type { MaheshvaraContentPart, MaheshvaraRequest, MaheshvaraResponseFormat, MaheshvaraTool, MaheshvaraToolCall } from '@elysia-ai/maheshvara'
import {
  CONTENT_AUDIO,
  CONTENT_FILE,
  CONTENT_IMAGE,
  CONTENT_REASONING,
  CONTENT_TEXT,
  CONTENT_TOOL_OUTPUT,
  CONTENT_VIDEO,
  INPUT_FUNCTION_CALL_OUTPUT,
  TOOL_FUNCTION,
} from '@elysia-ai/maheshvara'
import { collectInstructions, firstNonEmptyString } from '@elysia-ai/maheshvara'
import { maheshvaraToolChoiceToOpenAI, imagePartToOpenAIURL } from '@elysia-ai/protocol-openai'

function responsesInputRole(role: string): string {
  const normalized = role.trim().toLowerCase()
  if (normalized === 'assistant') return 'assistant'
  return 'user'
}

function responsesTextPartTypeForRole(role: string): string {
  if (responsesInputRole(role) === 'assistant') return 'output_text'
  return 'input_text'
}

function refusalTextFromRaw(raw: unknown): string {
  const m = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
  if (!m) return ''
  if (String(m['type'] ?? '').trim().toLowerCase() !== 'refusal') return ''
  const refusal = typeof m['refusal'] === 'string' ? m['refusal'] : ''
  if (refusal !== '') return refusal
  return typeof m['text'] === 'string' ? m['text'] : ''
}

function maheshvaraTextOf(parts: MaheshvaraContentPart[] | undefined): string {
  let out = ''
  for (const part of parts ?? []) {
    if (part.type === CONTENT_TEXT) out += part.text ?? ''
  }
  return out
}

/**
 * tool/function 消息的输出文本：优先 tool_output 部件载荷（桥接层的标准形态），
 * 回退纯 text 部件拼接（decode 侧重建形态）。此前只看 text 部件——
 * 桥接的 tool 消息输出恒为空串，function_call_output 丢失工具结果。
 */
function maheshvaraToolOutputOf(parts: MaheshvaraContentPart[] | undefined): string {
  let out = ''
  let sawToolOutput = false
  for (const part of parts ?? []) {
    if (part.type === CONTENT_TOOL_OUTPUT) {
      sawToolOutput = true
      out += part.tool_output ?? ''
    }
  }
  return sawToolOutput ? out : maheshvaraTextOf(parts)
}

export function maheshvaraToolCallsToResponsesItems(
  calls: MaheshvaraToolCall[] | undefined,
  msgIndex = 0,
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []
  let callIndex = -1
  for (const call of calls ?? []) {
    callIndex += 1
    let callID = (call.id ?? '').trim()
    const name = (call.name ?? '').trim()
    if (name === '') continue
    // P2-16：缺 id 不再静默丢弃（对应 function_call_output 失配 → 上游 400），
    // 参照 openai 侧 ensureToolCallID 合成确定性 id。
    if (callID === '') callID = `call_${msgIndex}_${callIndex}`
    // P2-17：非字符串 arguments（anthropic decode 产出对象）防御性 stringify，
    // 此前对象静默变 '{}' 导致跨 provider 多轮工具参数全丢。
    let args = ''
    if (typeof call.arguments === 'string') {
      args = call.arguments.trim()
    } else if (call.arguments !== undefined && call.arguments !== null) {
      try {
        args = JSON.stringify(call.arguments)
      } catch {
        args = ''
      }
    }
    if (args === '') args = '{}'
    items.push({ type: 'function_call', call_id: callID, name, arguments: args })
  }
  return items
}

function maheshvaraContentToResponsesInputContent(role: string, parts: MaheshvaraContentPart[] | undefined): Array<Record<string, unknown>> {
  const normalizedRole = responsesInputRole(role)
  const out: Array<Record<string, unknown>> = []
  for (const part of parts ?? []) {
    switch (part.type) {
      case CONTENT_TEXT: {
        if (part.text) {
          out.push({ type: responsesTextPartTypeForRole(normalizedRole), text: part.text })
        }
        break
      }
      case CONTENT_REASONING: {
        if (normalizedRole === 'assistant') {
          const text = part.reasoning_text || part.text || ''
          if (text) out.push({ type: 'output_text', text })
        }
        break
      }
      case CONTENT_IMAGE: {
        if (normalizedRole === 'user') {
          const url = imagePartToOpenAIURL(part)
          if (url !== '') out.push({ type: 'input_image', image_url: url })
        }
        break
      }
      case CONTENT_AUDIO: {
        if (normalizedRole === 'user') {
          // OpenAI 规范：载荷键为 input_audio，data 必须是裸 base64，
          // format 只接受 'wav' | 'mp3'（MIME 需映射，URL 无法内联则跳过）。
          const data = firstNonEmptyString(part.audio_base64 ?? '', part.data ?? '')
          if (data !== '') {
            const mime = firstNonEmptyString(part.media_type ?? '', part.mime_type ?? '').toLowerCase()
            const format = mime.includes('wav') ? 'wav' : 'mp3'
            out.push({ type: 'input_audio', input_audio: { data, format } })
          }
        }
        break
      }
      case CONTENT_VIDEO: {
        if (normalizedRole === 'user') {
          const url = firstNonEmptyString(part.video_url ?? '', part.uri ?? '', part.image_url ?? '')
          if (url) out.push({ type: 'input_video', video_url: url })
        }
        break
      }
      case CONTENT_FILE: {
        if (normalizedRole === 'user') {
          const item: Record<string, unknown> = { type: 'input_file' }
          if (part.file_id) item['file_id'] = part.file_id
          if (part.file_name) item['filename'] = part.file_name
          if (part.file_data) item['file_data'] = part.file_data
          if (Object.keys(item).length > 1) out.push(item)
        }
        break
      }
      default: {
        const refusal = refusalTextFromRaw(part.raw)
        if (normalizedRole === 'assistant' && refusal !== '') {
          out.push({ type: 'refusal', refusal })
        }
      }
    }
  }
  return out
}

/** rawResponsesInputItem：InputItems 解析时保留的原始 item 直接回放。 */
function rawResponsesInputItem(rawExtra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const raw = rawExtra?.['raw']
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return undefined
}

/**
 * P2-16：与 maheshvaraToolCallsToResponsesItems 的空 id 合成规则严格一致
 * （callIndex 对每个 call 递增、name 为空跳过、空 id 合成 call_${msgIndex}_${callIndex}），
 * 收集会被合成的 call_id，供后续空 tool_call_id 的 tool 消息回填配对。
 */
function collectSynthesizedCallIDs(calls: MaheshvaraToolCall[] | undefined, msgIndex: number): string[] {
  const ids: string[] = []
  let callIndex = -1
  for (const call of calls ?? []) {
    callIndex += 1
    if ((call.name ?? '').trim() === '') continue
    if ((call.id ?? '').trim() === '') ids.push(`call_${msgIndex}_${callIndex}`)
  }
  return ids
}

export function maheshvaraInputToResponses(req: MaheshvaraRequest): Array<Record<string, unknown>> {
  if ((req.input_items?.length ?? 0) > 0) {
    const items: Array<Record<string, unknown>> = []
    for (const item of req.input_items!) {
      if (item.type === INPUT_FUNCTION_CALL_OUTPUT) {
        items.push({ type: 'function_call_output', call_id: item.call_id, output: item.output })
        continue
      }
      const raw = rawResponsesInputItem(item.RawExtra)
      if (raw) {
        items.push(raw)
        continue
      }
      const role = responsesInputRole(item.role ?? '')
      const content = maheshvaraContentToResponsesInputContent(role, item.content)
      if (content.length === 0) continue
      items.push({ role, content })
    }
    return items
  }

  const items: Array<Record<string, unknown>> = []
  let msgIndex = -1
  // P2-16：assistant tool_calls 空 id 合成的 call_id 登记为待回填队列；
  // 后续空 tool_call_id 的 tool 消息按 FIFO 领取同一合成 id，
  // 保证 function_call 与 function_call_output 的 call_id 配对一致（否则上游 400）。
  const pendingSynthesizedCallIDs: string[] = []
  for (const msg of req.messages ?? []) {
    msgIndex += 1
    const role = (msg.role ?? '').trim().toLowerCase()
    if (role === '' || role === 'system' || role === 'developer') continue
    if (role === 'tool' || role === 'function') {
      const callID = (msg.tool_call_id ?? '').trim()
      const output = maheshvaraToolOutputOf(msg.content)
      if (callID === '') {
        const synthesized = pendingSynthesizedCallIDs.shift()
        if (synthesized !== undefined) {
          items.push({ type: 'function_call_output', call_id: synthesized, output })
          continue
        }
        items.push({ role: 'user', content: [{ type: 'input_text', text: `[tool_output_missing_call_id] ${output}` }] })
        continue
      }
      items.push({ type: 'function_call_output', call_id: callID, output })
      continue
    }
    const content = maheshvaraContentToResponsesInputContent(role, msg.content)
    if (content.length > 0) {
      items.push({ role: responsesInputRole(role), content })
    }
    if (role === 'assistant') {
      items.push(...maheshvaraToolCallsToResponsesItems(msg.tool_calls, msgIndex))
      pendingSynthesizedCallIDs.push(...collectSynthesizedCallIDs(msg.tool_calls, msgIndex))
    }
  }
  return items
}

export function maheshvaraToolsToResponses(tools: MaheshvaraTool[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const tool of tools) {
    if (tool.raw) {
      out.push(tool.raw)
      continue
    }
    const m: Record<string, unknown> = { type: tool.type }
    if (tool.type === TOOL_FUNCTION) {
      m['name'] = tool.name
      m['description'] = tool.description
      m['parameters'] = tool.parameters ?? tool.input_schema
      if (tool.strict !== undefined) m['strict'] = tool.strict
    }
    out.push(m)
  }
  return out
}

function maheshvaraResponseFormatToResponses(f: MaheshvaraResponseFormat): Record<string, unknown> {
  if (f.raw) return f.raw as Record<string, unknown>
  const out: Record<string, unknown> = { type: f.type }
  if (f.name) out['name'] = f.name
  if (f.description) out['description'] = f.description
  if (f.schema) out['schema'] = f.schema
  if (f.strict !== undefined) out['strict'] = f.strict
  return out
}

function applyResponsesRequestExtensions(out: Record<string, unknown>, req: MaheshvaraRequest): void {
  if (req.seed !== undefined) out['seed'] = req.seed
  if (req.service_tier) out['service_tier'] = req.service_tier
  if (req.max_tool_calls !== undefined) out['max_tool_calls'] = req.max_tool_calls
  if (req.top_logprobs !== undefined) out['top_logprobs'] = req.top_logprobs
  if (req.safety_identifier) out['safety_identifier'] = req.safety_identifier
  if (req.stream_options) {
    const streamOptions: Record<string, unknown> = { ...req.stream_options.raw }
    if (req.stream_options.include_usage) streamOptions['include_usage'] = true
    if (req.stream_options.include_obfuscation !== undefined) {
      streamOptions['include_obfuscation'] = req.stream_options.include_obfuscation
    }
    if (Object.keys(streamOptions).length > 0) out['stream_options'] = streamOptions
  }
  if (req.prompt_cache_key) out['prompt_cache_key'] = req.prompt_cache_key
  if (req.prompt_cache_retention !== undefined) out['prompt_cache_retention'] = req.prompt_cache_retention
}

/**
 * maheshvara 请求 → Responses API 请求体对象。
 * original 为可选的原始 Responses 请求（透传场景解析自 wire），提供时以其为基底
 * 保留未建模字段（对齐 Go MaheshvaraToResponsesRequest 的 original 参数语义）。
 */
export function encodeResponsesRequest(req: MaheshvaraRequest, original?: Record<string, unknown>): Record<string, unknown> {
  if (!req.model?.trim()) {
    throw new Error('cannot render openai_responses request without model')
  }
  const out: Record<string, unknown> = original ? structuredClone(original) : {}
  out['model'] = req.model
  const instructions = collectInstructions(req)
  if (instructions !== '') out['instructions'] = instructions
  if (req.user) out['user'] = req.user
  out['input'] = maheshvaraInputToResponses(req)
  if ((req.max_output_tokens ?? 0) > 0) out['max_output_tokens'] = req.max_output_tokens
  if (req.temperature !== undefined) out['temperature'] = req.temperature
  if (req.top_p !== undefined) out['top_p'] = req.top_p
  if (req.stream) out['stream'] = true
  if ((req.tools?.length ?? 0) > 0) out['tools'] = maheshvaraToolsToResponses(req.tools!)
  if (req.tool_choice !== undefined && req.tool_choice !== null) {
    out['tool_choice'] = maheshvaraToolChoiceToOpenAI(req.tool_choice)
  }
  if (req.parallel_tool_calls !== undefined) out['parallel_tool_calls'] = req.parallel_tool_calls
  if (req.response_format) {
    out['text'] = { format: maheshvaraResponseFormatToResponses(req.response_format) }
  }
  if (req.reasoning) {
    const reasoning: Record<string, unknown> = { ...(req.reasoning.raw ?? {}) }
    if ((req.reasoning.effort ?? '').toLowerCase() === 'none') {
      // 上游会把 effort:"none" 静默当成 low 档执行，必须整个省略字段。
      delete reasoning['effort']
    } else if (req.reasoning.effort) {
      reasoning['effort'] = req.reasoning.effort
    }
    out['reasoning'] = reasoning
  }
  // 携带加密思考历史的请求发给 Responses 上游时，追加 include 让上游返回
  // 加密思考，跨轮续用才可行。
  if (maheshvaraRequestHasEncryptedReasoning(req)) {
    out['include'] = appendResponsesInclude(out['include'], 'reasoning.encrypted_content')
  }
  applyResponsesRequestExtensions(out, req)
  return out
}

function maheshvaraRequestHasEncryptedReasoning(req: MaheshvaraRequest): boolean {
  for (const msg of req.messages ?? []) {
    for (const part of msg.content ?? []) {
      if (part.type === 'reasoning' && part.encrypted_content) return true
    }
  }
  for (const item of req.input_items ?? []) {
    if (item.reasoning?.encrypted_content) return true
  }
  return false
}

function appendResponsesInclude(current: unknown, value: string): string[] {
  const include: string[] = []
  if (Array.isArray(current)) {
    for (const item of current) {
      if (typeof item === 'string') include.push(item)
    }
  } else if (typeof current === 'string') {
    include.push(current)
  }
  if (!include.includes(value)) include.push(value)
  return include
}
