/**
 * maheshvara → Gemini generateContent wire 请求构造。
 * 对齐 maheshvara_convert.go 的 MaheshvaraToGeminiRequest / maheshvaraMessagesToGemini /
 * maheshvaraToolsToGemini / maheshvaraToolChoiceToGemini，以及
 * maheshvara_extensions.go 的 maheshvaraPartToGeminiPart / geminiToolConfig /
 * applyGeminiRequestExtensionsToBody / maheshvaraStopSequences。
 */

import type { MaheshvaraContentPart, MaheshvaraRequest, MaheshvaraResponseFormat, MaheshvaraTool } from '@elysia-ai/maheshvara'
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
  SIGNATURE_PROVIDER_GEMINI,
  TOOL_FUNCTION,
} from '@elysia-ai/maheshvara'
import {
  maheshvaraSignatureForProvider,
  collectInstructions,
  firstNonEmptyString,
  imagePartBase64,
  stringValue,
  stringSlice,
} from '@elysia-ai/maheshvara'

/**
 * 跨厂商 functionCall 缺失 thoughtSignature 时的占位签名：
 * Gemini 对来自其他厂商的历史 functionCall 部件要求校验签名，
 * 此占位让上游跳过校验（Go geminiCrossProviderThoughtSignature）。
 */
export const GEMINI_CROSS_PROVIDER_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/** 图片部件 → Gemini inlineData（base64）或 fileData（URL）part。 */
export function imagePartToGeminiPart(part: MaheshvaraContentPart): Record<string, unknown> | undefined {
  const { mediaType, base64 } = imagePartBase64(part)
  if (base64 !== '') {
    return { inlineData: { mimeType: mediaType || 'image/png', data: base64 } }
  }
  const uri = firstNonEmptyString(part.image_url ?? '', part.uri ?? '')
  if (uri !== '') {
    const fileData: Record<string, unknown> = { fileUri: uri }
    if (part.media_type) fileData['mimeType'] = part.media_type
    return { fileData }
  }
  return undefined
}

/** 音/视/文件/文档部件 → Gemini inlineData / fileData part。 */
export function maheshvaraPartToGeminiPart(part: MaheshvaraContentPart): Record<string, unknown> | undefined {
  const mediaType = firstNonEmptyString(part.media_type ?? '', part.mime_type ?? '')
  const data = firstNonEmptyString(part.data ?? '', part.audio_base64 ?? '', part.video_base64 ?? '', part.file_data ?? '')
  const uri = firstNonEmptyString(part.uri ?? '', part.audio_url ?? '', part.video_url ?? '', part.image_url ?? '')
  if (data !== '') {
    let resolvedType = mediaType
    if (resolvedType === '') {
      switch (part.type) {
        case CONTENT_AUDIO: resolvedType = 'audio/mpeg'; break
        case CONTENT_VIDEO: resolvedType = 'video/mp4'; break
        default: resolvedType = 'application/octet-stream'
      }
    }
    return { inlineData: { mimeType: resolvedType, data } }
  }
  if (uri !== '') {
    const fileData: Record<string, unknown> = { fileUri: uri }
    if (mediaType !== '') fileData['mimeType'] = mediaType
    return { fileData }
  }
  return undefined
}

function maheshvaraStopSequences(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined
  const text = stringValue(value)
  if (text !== '') return [text]
  return stringSlice(value)
}

export function maheshvaraToolsToGemini(tools: MaheshvaraTool[]): Array<Record<string, unknown>> {
  const declarations: Array<Record<string, unknown>> = []
  const nativeTools: Array<Record<string, unknown>> = []
  for (const tool of tools) {
    if (tool.type !== TOOL_FUNCTION) {
      if (tool.raw) {
        nativeTools.push(tool.raw)
        continue
      }
      throw new Error(`builtin tool ${JSON.stringify(tool.type)} cannot be transformed to Gemini without a native definition`)
    }
    const declaration: Record<string, unknown> = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? tool.input_schema,
    }
    if (tool.strict !== undefined) declaration['strict'] = tool.strict
    declarations.push(declaration)
  }
  const out: Array<Record<string, unknown>> = []
  if (declarations.length > 0) out.push({ functionDeclarations: declarations })
  out.push(...nativeTools)
  return out
}

function geminiToolConfig(choiceType: string, name: string): Record<string, unknown> {
  let mode = 'AUTO'
  switch (choiceType.trim().toLowerCase()) {
    case 'none': mode = 'NONE'; break
    case 'required':
    case 'any':
    case 'force':
    case 'function': mode = 'ANY'; break
  }
  const config: Record<string, unknown> = { mode }
  if (name !== '') config['allowedFunctionNames'] = [name]
  return { functionCallingConfig: config }
}

export function maheshvaraToolChoiceToGemini(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (object['functionCallingConfig'] !== undefined) return object
    const choiceType = stringValue(object['type']).toLowerCase()
    let name = firstNonEmptyString(stringValue(object['name']), stringValue(object['function_name']))
    const fn = object['function']
    if (typeof fn === 'object' && fn !== null) {
      name = firstNonEmptyString(name, stringValue((fn as Record<string, unknown>)['name']))
    }
    return geminiToolConfig(choiceType, name)
  }
  return geminiToolConfig(stringValue(value).toLowerCase(), '')
}

function applyResponseFormatToGemini(cfg: Record<string, unknown>, f: MaheshvaraResponseFormat): void {
  if (f.type === 'json_schema' || f.type === 'json_object') {
    cfg['responseMimeType'] = 'application/json'
    if (f.schema) cfg['responseSchema'] = f.schema
  }
}

function applyGeminiRequestExtensions(out: Record<string, unknown>, req: MaheshvaraRequest): void {
  if ((req.safety_settings?.length ?? 0) > 0) {
    const settings: Array<Record<string, unknown>> = []
    for (const setting of req.safety_settings!) {
      const item: Record<string, unknown> = {}
      if (setting.category) item['category'] = setting.category
      if (setting.threshold) item['threshold'] = setting.threshold
      if (setting.action) item['action'] = setting.action
      if (Object.keys(item).length > 0) settings.push(item)
    }
    if (settings.length > 0) out['safetySettings'] = settings
  }
  if (req.cache_control !== undefined) out['cachedContent'] = req.cache_control
  const generationConfig = asGenerationConfig(out)
  if (req.n !== undefined) generationConfig['candidateCount'] = req.n
  if (req.seed !== undefined) generationConfig['seed'] = req.seed
  if (req.presence_penalty !== undefined) generationConfig['presencePenalty'] = req.presence_penalty
  if (req.frequency_penalty !== undefined) generationConfig['frequencyPenalty'] = req.frequency_penalty
  if (req.logprobs !== undefined) generationConfig['responseLogprobs'] = req.logprobs
  if (req.top_logprobs !== undefined) generationConfig['logprobs'] = req.top_logprobs
  if ((req.modalities?.length ?? 0) > 0) generationConfig['responseModalities'] = req.modalities
  const stopSequences = maheshvaraStopSequences(req.stop)
  if (stopSequences && stopSequences.length > 0) generationConfig['stopSequences'] = stopSequences
  if (Object.keys(generationConfig).length > 0) out['generationConfig'] = generationConfig
}

function asGenerationConfig(out: Record<string, unknown>): Record<string, unknown> {
  const existing = out['generationConfig']
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const cfg: Record<string, unknown> = {}
  out['generationConfig'] = cfg
  return cfg
}

export function maheshvaraMessagesToGemini(req: MaheshvaraRequest): Array<Record<string, unknown>> {
  // functionResponse.name 必须是函数名而非 tool_use_id：先建 id→name 映射。
  const toolCallNames = new Map<string, string>()
  for (const msg of req.messages ?? []) {
    for (const call of msg.tool_calls ?? []) {
      if (call.id && call.name) toolCallNames.set(call.id, call.name)
    }
  }

  const contents: Array<Record<string, unknown>> = []
  let msgIndex = 0
  for (const msg of req.messages ?? []) {
    const originalIndex = msgIndex++
    const roleTrimmed = (msg.role ?? '').trim().toLowerCase()
    if (roleTrimmed === 'system' || roleTrimmed === 'developer') continue
    let role = roleTrimmed
    if (role === 'assistant') role = 'model'
    else if (role === 'tool' || role === 'function' || role === 'developer' || role === '') role = 'user'

    const parts: Array<Record<string, unknown>> = []
    let firstFunctionCallPart: Record<string, unknown> | undefined
    let partIndex = 0
    for (const part of msg.content ?? []) {
      const originalPartIndex = partIndex++
      switch (part.type) {
        case CONTENT_TEXT: {
          if (part.text) parts.push({ text: part.text })
          break
        }
        case CONTENT_IMAGE: {
          const p = imagePartToGeminiPart(part)
          if (p) parts.push(p)
          break
        }
        case CONTENT_AUDIO:
        case CONTENT_VIDEO:
        case CONTENT_FILE:
        case CONTENT_DOCUMENT: {
          const p = maheshvaraPartToGeminiPart(part)
          if (p) parts.push(p)
          break
        }
        case CONTENT_REASONING: {
          const reasoningText = part.reasoning_text || part.text || ''
          if (reasoningText) {
            const thought: Record<string, unknown> = { text: reasoningText, thought: true }
            const signature = maheshvaraSignatureForProvider(part.signature, part.signature_provider, SIGNATURE_PROVIDER_GEMINI)
            if (signature !== '') thought['thoughtSignature'] = signature
            parts.push(thought)
          }
          break
        }
        case CONTENT_REFUSAL: {
          if (part.text) parts.push({ text: part.text })
          break
        }
        case CONTENT_TOOL_OUTPUT: {
          const responseMap = geminiFunctionResponsePayload(part.tool_output ?? '')
          let name = toolCallNames.get(part.tool_call_id ?? '')
          if (!name) {
            name = functionResponseNameFromRaw(part.raw)
          }
          if (!name || name.trim() === '') {
            throw new Error(
              `cannot convert message ${originalIndex} part ${originalPartIndex} to Gemini: `
              + `function response tool_use_id ${JSON.stringify(part.tool_call_id)} has no matching function name`,
            )
          }
          const response: Record<string, unknown> = { name, response: responseMap }
          let responseID = functionResponseIDFromRaw(part.raw)
          if (responseID === '' && part.tool_call_id && part.tool_call_id !== name) {
            responseID = part.tool_call_id
          }
          if (responseID !== '') response['id'] = responseID
          parts.push({ functionResponse: response })
          break
        }
      }
    }
    let callIndex = 0
    for (const call of msg.tool_calls ?? []) {
      const originalCallIndex = callIndex++
      if (!(call.name ?? '').trim()) {
        throw new Error(
          `cannot convert message ${originalIndex} tool call ${originalCallIndex} to Gemini: `
          + `missing function name for call id ${JSON.stringify(call.id)}`,
        )
      }
      let args: unknown = {}
      if (typeof call.arguments === 'string' && call.arguments.length > 0) {
        try {
          args = JSON.parse(call.arguments)
        } catch {
          args = {}
          if (call.arguments_text) {
            try {
              args = JSON.parse(call.arguments_text)
            } catch {
              args = {}
            }
          }
        }
      } else if (call.arguments !== undefined && call.arguments !== null) {
        args = call.arguments
      }
      const functionCall: Record<string, unknown> = { name: call.name, args }
      if (call.id) functionCall['id'] = call.id
      const part: Record<string, unknown> = { functionCall }
      if (!firstFunctionCallPart) firstFunctionCallPart = part
      const signature = maheshvaraSignatureForProvider(call.thought_signature, call.thought_signature_provider, SIGNATURE_PROVIDER_GEMINI)
      if (signature !== '') part['thoughtSignature'] = signature
      parts.push(part)
    }
    // 跨厂商 functionCall 没有签名时给占位，跳过上游签名校验。
    if (firstFunctionCallPart && stringValue(firstFunctionCallPart['thoughtSignature']) === '') {
      firstFunctionCallPart['thoughtSignature'] = GEMINI_CROSS_PROVIDER_THOUGHT_SIGNATURE
    }
    if (parts.length === 0) continue
    // Gemini 不允许连续同角色 content：合并进上一条。
    const last = contents[contents.length - 1]
    if (contents.length > 0 && last['role'] === role) {
      const previousParts = (last['parts'] as Array<Record<string, unknown>>) ?? []
      last['parts'] = [...previousParts, ...parts]
      continue
    }
    contents.push({ role, parts })
  }
  if (contents.length === 0) {
    throw new Error('cannot convert request to Gemini: no representable message content')
  }
  return contents
}

function functionResponseNameFromRaw(raw: unknown): string {
  const object = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
  if (!object) return ''
  const response = typeof object['functionResponse'] === 'object' && object['functionResponse'] !== null
    ? object['functionResponse'] as Record<string, unknown>
    : undefined
  if (response) {
    return firstNonEmptyString(stringValue(response['name']), stringValue(response['function_name']))
  }
  return firstNonEmptyString(stringValue(object['name']), stringValue(object['function_name']))
}

function functionResponseIDFromRaw(raw: unknown): string {
  const object = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
  if (!object) return ''
  const response = typeof object['functionResponse'] === 'object' && object['functionResponse'] !== null
    ? object['functionResponse'] as Record<string, unknown>
    : undefined
  if (response) {
    return firstNonEmptyString(stringValue(response['id']), stringValue(response['call_id']))
  }
  return firstNonEmptyString(stringValue(object['id']), stringValue(object['call_id']))
}

function geminiFunctionResponsePayload(output: string): Record<string, unknown> {
  if (output === '') return { content: '' }
  try {
    const object = JSON.parse(output)
    if (object !== null && typeof object === 'object' && !Array.isArray(object)) {
      return object as Record<string, unknown>
    }
    if (Array.isArray(object)) {
      return { result: object }
    }
  } catch {
    // 落到字符串路径
  }
  return { content: output }
}

/** maheshvara 请求 → Gemini generateContent 请求体对象。 */
export function encodeGenerateContentRequest(req: MaheshvaraRequest): Record<string, unknown> {
  // 单候选契约（对齐 Go 解析侧 candidateCount>1 拒绝）：多候选会绕过
  // 单 candidate 解码路径，直接拒绝而非静默取第一个。
  if (req.n !== undefined && req.n > 1) {
    throw new Error(`gemini generateContent supports a single candidate only, got n=${req.n}`)
  }
  const contents = maheshvaraMessagesToGemini(req)
  const out: Record<string, unknown> = { contents }
  const instructions = collectInstructions(req)
  if (instructions !== '') {
    out['systemInstruction'] = { parts: [{ text: instructions }] }
  }
  const cfg: Record<string, unknown> = {}
  if (req.temperature !== undefined) cfg['temperature'] = req.temperature
  if (req.top_p !== undefined) cfg['topP'] = req.top_p
  if (req.top_k !== undefined) cfg['topK'] = req.top_k
  if ((req.max_output_tokens ?? 0) > 0) cfg['maxOutputTokens'] = req.max_output_tokens
  if (req.response_format) applyResponseFormatToGemini(cfg, req.response_format)
  if (Object.keys(cfg).length > 0) out['generationConfig'] = cfg
  if ((req.tools?.length ?? 0) > 0) out['tools'] = maheshvaraToolsToGemini(req.tools!)
  if (req.tool_choice !== undefined && req.tool_choice !== null) {
    const toolConfig = maheshvaraToolChoiceToGemini(req.tool_choice)
    if (toolConfig) out['toolConfig'] = toolConfig
  }
  if (req.thinking?.enabled) {
    const thinkingConfig: Record<string, unknown> = { includeThoughts: true }
    if (req.thinking.effort) thinkingConfig['thinkingLevel'] = req.thinking.effort
    if ((req.thinking.budget_tokens ?? 0) > 0) thinkingConfig['thinkingBudget'] = req.thinking.budget_tokens
    const generationConfig = asGenerationConfig(out)
    generationConfig['thinkingConfig'] = thinkingConfig
  }
  applyGeminiRequestExtensions(out, req)
  return out
}
