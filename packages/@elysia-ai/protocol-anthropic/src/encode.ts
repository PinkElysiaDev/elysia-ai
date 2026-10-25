/**
 * maheshvara → Anthropic Messages wire 请求构造。
 * 对齐 maheshvara_convert.go 的 MaheshvaraToClaudeRequest / maheshvaraMessagesToClaude /
 * maheshvaraToolsToClaude / maheshvaraToolChoiceToClaude，以及
 * maheshvara_extensions.go 的 maheshvaraDocumentToClaudeBlock / maheshvaraMediaToClaudeBlock。
 */

import type { MaheshvaraContentPart, MaheshvaraRequest, MaheshvaraTool } from '@elysia-ai/maheshvara'
import {
  CONTENT_AUDIO,
  CONTENT_DOCUMENT,
  CONTENT_FILE,
  CONTENT_IMAGE,
  CONTENT_REASONING,
  CONTENT_REFUSAL,
  CONTENT_TEXT,
  CONTENT_TOOL_OUTPUT,
  CONTENT_VIDEO,
  SIGNATURE_PROVIDER_ANTHROPIC,
  TOOL_FUNCTION,
} from '@elysia-ai/maheshvara'
import {
  maheshvaraSignatureForProvider,
  asRecord,
  collectInstructions,
  encodeMaheshvaraReasoningEnvelope,
  firstNonEmptyString,
  imagePartBase64,
  stringValue,
} from '@elysia-ai/maheshvara'

/** Anthropic 强制要求 max_tokens；缺省给一个大默认值（Go ClaudeDefaultMaxTokens）。 */
export const CLAUDE_DEFAULT_MAX_TOKENS = 65536

// 思考预算的官方档位边界（Claude budget 档：low/medium/high/xhigh）。
const EFFORT_BUDGET_LOW = 1024
const EFFORT_BUDGET_MEDIUM = 4096
const EFFORT_BUDGET_HIGH = 16384
const EFFORT_BUDGET_MAX = 32000

/** effort 档位量化回固定预算（xhigh 与 max 共享 32000 上限）。 */
export function budgetFromEffort(effort: string | undefined): number {
  switch ((effort ?? '').toLowerCase()) {
    case 'low': return EFFORT_BUDGET_LOW
    case 'medium': return EFFORT_BUDGET_MEDIUM
    case 'high': return EFFORT_BUDGET_HIGH
    case 'xhigh':
    case 'max': return EFFORT_BUDGET_MAX
    default: return EFFORT_BUDGET_MEDIUM
  }
}

/**
 * 计算推理 part 走 Claude 线时的签名槽位值：
 * - 厂商原生签名（provider 匹配 anthropic）原样使用；
 * - 携带密文的跨协议思考装进信封（v2，随载签发方与模型），客户端原样
 *   回传后解出回放；签发方非 anthropic 时密文绝不以原生形态发给 Claude
 *   上游；签发方不明的密文不回放（门控无法判断归属，发给任何上游都可能被拒）。
 */
function claudeThinkingSignatureForPart(part: MaheshvaraContentPart, model: string): string {
  const signature = maheshvaraSignatureForProvider(part.signature, part.signature_provider, SIGNATURE_PROVIDER_ANTHROPIC)
  if (signature !== '') return signature
  if ((part.encrypted_content ?? '').trim() === '') return ''
  if (part.encrypted_provider === SIGNATURE_PROVIDER_ANTHROPIC) {
    // anthropic 的"密文"就是 thinking 签名本身，无需再包信封。
    return part.encrypted_content
  }
  const provider = firstNonEmptyString(part.encrypted_provider ?? '', part.signature_provider ?? '')
  if (provider === '') return ''
  return encodeMaheshvaraReasoningEnvelope(
    firstNonEmptyString(part.reasoning_text ?? '', part.text ?? ''),
    part.encrypted_content,
    part.reasoning_summary ?? [],
    provider,
    firstNonEmptyString(part.encrypted_model ?? '', model),
  )
}

/** 图片部件 → Claude image block 的 source。 */
export function imagePartToClaudeSource(part: MaheshvaraContentPart): Record<string, unknown> | undefined {
  const { mediaType, base64 } = imagePartBase64(part)
  if (base64 !== '') {
    return { type: 'base64', media_type: mediaType || 'image/png', data: base64 }
  }
  const uri = firstNonEmptyString(part.image_url ?? '', part.uri ?? '')
  if (uri !== '') return { type: 'url', url: uri }
  return undefined
}

function maheshvaraDocumentToClaudeBlock(part: MaheshvaraContentPart): Record<string, unknown> | undefined {
  if (part.file_data) {
    const mediaType = firstNonEmptyString(part.media_type ?? '', part.mime_type ?? '', 'application/octet-stream')
    return { type: 'document', source: { type: 'base64', media_type: mediaType, data: part.file_data } }
  }
  const uri = firstNonEmptyString(part.uri ?? '', part.image_url ?? '')
  if (uri !== '') {
    return { type: 'document', source: { type: 'url', url: uri } }
  }
  if (part.file_id) {
    return { type: 'document', source: { type: 'file', file_id: part.file_id } }
  }
  return undefined
}

function maheshvaraMediaToClaudeBlock(part: MaheshvaraContentPart): Record<string, unknown> | undefined {
  const data = firstNonEmptyString(part.data ?? '', part.audio_base64 ?? '', part.video_base64 ?? '')
  const mediaType = firstNonEmptyString(part.media_type ?? '', part.mime_type ?? '')
  if (data !== '') {
    return { type: part.type, source: { type: 'base64', media_type: mediaType, data } }
  }
  const uri = firstNonEmptyString(part.uri ?? '', part.audio_url ?? '', part.video_url ?? '', part.image_url ?? '')
  if (uri !== '') {
    return { type: part.type, source: { type: 'url', url: uri } }
  }
  return undefined
}

/** 保留非空原始 ID，否则合成确定性 ID（与 openai 侧 ensureToolCallID 约定一致）。
 * Claude 对 tool_use.id / tool_result.tool_use_id 是必填强校验。 */
export function ensureClaudeToolCallID(id: string | undefined, msgIndex: number, callIndex: number): string {
  if ((id ?? '').trim() !== '') return id as string
  return `call_${msgIndex}_${callIndex}`
}

export function maheshvaraMessagesToClaude(req: MaheshvaraRequest): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  let msgIndex = -1
  for (const msg of req.messages ?? []) {
    msgIndex += 1
    const roleTrimmed = (msg.role ?? '').trim().toLowerCase()
    if (roleTrimmed === 'system' || roleTrimmed === 'developer') continue
    let role = roleTrimmed
    const isToolMessage = role === 'tool' || role === 'function'
    if (isToolMessage || role === '') role = 'user'
    const content: Array<Record<string, unknown>> = []
    for (const part of msg.content ?? []) {
      switch (part.type) {
        case CONTENT_TEXT: {
          if (!part.text) continue
          const block: Record<string, unknown> = { type: 'text', text: part.text }
          if (part.cache_control !== undefined) block['cache_control'] = part.cache_control
          if ((part.citations?.length ?? 0) > 0) block['citations'] = part.citations
          content.push(block)
          break
        }
        case CONTENT_REASONING: {
          const text = firstNonEmptyString(part.reasoning_text ?? '', part.text ?? '')
          const signature = claudeThinkingSignatureForPart(part, req.model)
          if (text !== '' || signature !== '') {
            content.push({ type: 'thinking', thinking: text, signature })
          }
          break
        }
        case CONTENT_IMAGE: {
          const source = imagePartToClaudeSource(part)
          if (source) content.push({ type: 'image', source })
          break
        }
        case CONTENT_TOOL_OUTPUT: {
          if (part.tool_call_id) {
            content.push({ type: 'tool_result', tool_use_id: part.tool_call_id, content: part.tool_output })
          }
          break
        }
        case CONTENT_REFUSAL: {
          if (part.text) content.push({ type: 'text', text: part.text })
          break
        }
        case CONTENT_DOCUMENT: {
          const block = maheshvaraDocumentToClaudeBlock(part)
          if (block) content.push(block)
          break
        }
        case CONTENT_AUDIO:
        case CONTENT_VIDEO: {
          const block = maheshvaraMediaToClaudeBlock(part)
          if (block) content.push(block)
          break
        }
        default: {
          // 服务端工具块（server_tool_use / web_search_tool_result 等）与未知
          // Claude 块：整块原样回放（raw 为完整原始对象）。
          const raw = asRecord(part.raw)
          if (raw && raw['type'] !== undefined) content.push(raw)
          break
        }
      }
    }
    for (const call of msg.tool_calls ?? []) {
      let input: unknown = {}
      if (typeof call.arguments === 'string' && call.arguments.length > 0) {
        try {
          input = JSON.parse(call.arguments)
        } catch {
          input = {}
        }
      } else if (call.arguments !== undefined && call.arguments !== null) {
        input = call.arguments
      }
      content.push({
        type: 'tool_use',
        id: ensureClaudeToolCallID(call.id, msgIndex, content.length),
        name: call.name,
        input,
      })
    }
    if (isToolMessage && msg.tool_call_id && !content.some((block) => block['type'] === 'tool_result')) {
      // OpenAI 形态的工具结果（role:'tool' + 顶层 tool_call_id + 纯文本 content）
      // 必须映射为 tool_result block，否则 Claude 会因 "tool_use ids were found
      // without tool_result blocks" 拒绝请求。
      const wrapped = [...content]
      content.length = 0
      content.push({ type: 'tool_result', tool_use_id: msg.tool_call_id, content: wrapped })
    }
    if (content.length === 0) continue

    // Claude 要求 user/assistant 严格交替：连续同角色合并进上一条
    // （system/developer 剔除后常出现相邻同角色）。
    const last = messages[messages.length - 1]
    if (last && last['role'] === role) {
      const previousContent = (last['content'] as Array<Record<string, unknown>>) ?? []
      last['content'] = [...previousContent, ...content]
      continue
    }
    messages.push({ role, content })
  }

  // Claude 要求首条消息必须是 user：assistant 开头时补一条最小 user 消息。
  if (messages.length > 0 && messages[0]['role'] !== 'user') {
    messages.unshift({
      role: 'user',
      content: [{ type: 'text', text: '(conversation start)' }],
    })
  }
  return messages
}

export function maheshvaraToolsToClaude(tools: MaheshvaraTool[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const tool of tools) {
    if (tool.type !== TOOL_FUNCTION) {
      throw new Error(`builtin tool ${JSON.stringify(tool.type)} cannot be transformed to Claude messages`)
    }
    const inputSchema = tool.input_schema ?? tool.parameters
    const item: Record<string, unknown> = {
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema,
    }
    if (tool.strict !== undefined) item['strict'] = tool.strict
    if (tool.cache_control !== undefined) item['cache_control'] = tool.cache_control
    out.push(item)
  }
  return out
}

export function maheshvaraToolChoiceToClaude(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const fn = object['function']
    if (typeof fn === 'object' && fn !== null && stringValue((fn as Record<string, unknown>)['name']) !== '') {
      return { type: 'tool', name: stringValue((fn as Record<string, unknown>)['name']) }
    }
    if (stringValue(object['type']) === 'function' && stringValue(object['name']) !== '') {
      return { type: 'tool', name: stringValue(object['name']) }
    }
    let choiceType = stringValue(object['type']).trim().toLowerCase()
    if (choiceType !== '') {
      if (choiceType === 'required') choiceType = 'any'
      return { type: choiceType }
    }
  }
  const choice = stringValue(value).trim().toLowerCase()
  if (choice === '') return undefined
  return { type: choice }
}

/**
 * parallel_tool_calls=false 时并入 tool_choice 的 disable_parallel_tool_use
 * 标记（Go applyClaudeDisableParallelToolUse）：未给 tool_choice 时补 auto
 * 形态；type=none 不加（none 无并行语义）。
 */
export function applyClaudeDisableParallelToolUse(toolChoice: unknown, parallel: boolean | undefined): unknown {
  if (parallel === undefined || parallel === true) return toolChoice
  if (typeof toolChoice !== 'object' || toolChoice === null || Array.isArray(toolChoice)) {
    if (toolChoice !== undefined && toolChoice !== null) return toolChoice
    const object: Record<string, unknown> = { type: 'auto' }
    object['disable_parallel_tool_use'] = true
    return object
  }
  const object = toolChoice as Record<string, unknown>
  if (String(object['type'] ?? '').trim().toLowerCase() !== 'none') {
    object['disable_parallel_tool_use'] = true
  }
  return object
}

function applyClaudeRequestExtensions(out: Record<string, unknown>, req: MaheshvaraRequest): void {
  if (req.top_k !== undefined) out['top_k'] = req.top_k
  if (req.metadata !== undefined) out['metadata'] = req.metadata
  // 调用方身份映射：Claude 把 user 放在 metadata.user_id（对齐 URPV2-8c）。
  if (req.user) {
    const metadata = asRecord(out['metadata']) ?? {}
    if (metadata['user_id'] === undefined) {
      metadata['user_id'] = req.user
      out['metadata'] = metadata
    }
  }
  if (req.service_tier) out['service_tier'] = req.service_tier
  if (req.cache_control !== undefined) out['cache_control'] = req.cache_control
}

/** maheshvara 请求 → Anthropic Messages 请求体对象。 */
export function encodeMessagesRequest(req: MaheshvaraRequest): Record<string, unknown> {
  if (!req.model?.trim()) {
    throw new Error('cannot render claude request without model')
  }
  const out: Record<string, unknown> = {
    model: req.model,
    messages: maheshvaraMessagesToClaude(req),
    // Anthropic 强制要求 max_tokens：未指定时给大默认值；
    // 调用方显式给出的值原样使用（含较小值）。
    max_tokens: (req.max_output_tokens ?? 0) > 0 ? req.max_output_tokens : CLAUDE_DEFAULT_MAX_TOKENS,
  }
  // 优先原样回放 Claude 客户端的 system 块数组（保住块级 cache_control
  // 标记——拍平成纯文本会让缓存省钱设置静默失效）；无原始块时退回拼接文本。
  const rawSystemBlocks = req.RawExtra?.['claude_system_blocks']
  if (rawSystemBlocks !== undefined && rawSystemBlocks !== null && (Array.isArray(rawSystemBlocks) ? rawSystemBlocks.length > 0 : true)) {
    out['system'] = rawSystemBlocks
  } else {
    const instructions = collectInstructions(req)
    if (instructions !== '') out['system'] = instructions
  }
  if (req.temperature !== undefined) out['temperature'] = req.temperature
  if (req.top_p !== undefined) out['top_p'] = req.top_p
  if (req.stream) out['stream'] = true
  if (req.stop !== undefined && req.stop !== null) {
    // Anthropic 只接受 string[]；maheshvara 的 stop 保留 OpenAI 的 string|string[]
    // 两种形态，单字符串需归一为数组。
    out['stop_sequences'] = typeof req.stop === 'string' ? [req.stop] : req.stop
  }
  if ((req.tools?.length ?? 0) > 0) out['tools'] = maheshvaraToolsToClaude(req.tools!)
  // parallel_tool_calls=false 时并入 tool_choice 的 disable_parallel_tool_use 标记
  // （Go applyClaudeDisableParallelToolUse）：未显式禁用时 Anthropic 默认并行。
  const toolChoice = applyClaudeDisableParallelToolUse(
    req.tool_choice !== undefined && req.tool_choice !== null ? maheshvaraToolChoiceToClaude(req.tool_choice) : undefined,
    req.parallel_tool_calls,
  )
  if (toolChoice !== undefined && toolChoice !== null) {
    out['tool_choice'] = toolChoice
  }
  if (req.thinking?.enabled) {
    if (req.thinking.adaptive) {
      // 自适应思考（Claude 4.5+）：无固定预算，档位走 output_config.effort。
      out['thinking'] = { type: 'adaptive' }
      if (req.thinking.effort) out['output_config'] = { effort: req.thinking.effort }
    } else {
      let budget = req.thinking.budget_tokens ?? 0
      if (budget <= 0) budget = budgetFromEffort(req.thinking.effort)
      out['thinking'] = { type: 'enabled', budget_tokens: budget }
    }
    // Claude 开思考时必须 temperature=1 且不带 top_p。
    out['temperature'] = 1.0
    delete out['top_p']
  }
  applyClaudeRequestExtensions(out, req)
  return out
}
