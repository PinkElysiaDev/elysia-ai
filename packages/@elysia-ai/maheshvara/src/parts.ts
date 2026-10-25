/**
 * 多模态内容部件的公共转换逻辑（协议无关部分）。
 * 对齐 Elysia-Api Go 侧 maheshvara.go 的 interfaceToContentParts / maheshvaraText /
 * parseDataURL / imagePartBase64，以及 maheshvara_convert.go 的
 * maheshvaraResponsesInstructions（此处命名 collectInstructions）。
 *
 * 各协议的定向渲染（imagePartToClaudeSource 等）放在对应 protocol 包里，
 * 这里只放双向都要用的中立逻辑。
 */

import type { MaheshvaraContentPart, MaheshvaraRequest, MaheshvaraUsage } from './maheshvara.js'
import { CONTENT_AUDIO, CONTENT_DOCUMENT, CONTENT_FILE, CONTENT_IMAGE, CONTENT_REASONING, CONTENT_REFUSAL, CONTENT_TEXT, CONTENT_TOOL_OUTPUT, CONTENT_VIDEO } from './constants.js'
import { asRecord, contentValueToString, firstNonEmptyString, firstNonValue, intValue, stringValue } from './accessors.js'

/** 解析 data:[<mediatype>][;base64],<data> URI（Go parseDataURL）。 */
export function parseDataURL(uri: string): { mediaType: string, data: string } | undefined {
  if (!uri.startsWith('data:')) return undefined
  const rest = uri.slice('data:'.length)
  const comma = rest.indexOf(',')
  if (comma < 0) return undefined
  let meta = rest.slice(0, comma)
  if (meta.endsWith(';base64')) meta = meta.slice(0, -';base64'.length)
  return { mediaType: meta, data: rest.slice(comma + 1) }
}

/** 从图片部件提取 (mediaType, base64)，支持内嵌 data: URI（Go imagePartBase64）。 */
export function imagePartBase64(part: MaheshvaraContentPart): { mediaType: string, base64: string } {
  if (part.image_base64) return { mediaType: part.media_type ?? '', base64: part.image_base64 }
  const uri = firstNonEmptyString(part.image_url ?? '', part.uri ?? '')
  if (uri.startsWith('data:')) {
    const parsed = parseDataURL(uri)
    if (parsed) return { mediaType: parsed.mediaType, base64: parsed.data }
  }
  return { mediaType: '', base64: '' }
}

/**
 * 把 OpenAI/Responses 词汇的多模态内容数组（或纯字符串）解析为 maheshvara 部件。
 * 覆盖 text / reasoning / image_url / input_audio / video / file / document /
 * refusal / tool_result 及未知类型（保留 raw）。Go interfaceToContentParts 的完整移植。
 */
export function interfaceToContentParts(content: unknown): MaheshvaraContentPart[] {
  if (content === null || content === undefined) return []
  if (typeof content === 'string') {
    return [{ type: CONTENT_TEXT, text: content }]
  }
  const object = asRecord(content)
  if (object) return interfaceToContentParts([object])
  if (!Array.isArray(content)) {
    return [{ type: CONTENT_TEXT, text: String(content) }]
  }

  const parts: MaheshvaraContentPart[] = []
  for (const item of content) {
    const m = asRecord(item)
    if (!m) continue
    const t = stringValue(m['type'])
    switch (t) {
      case 'text':
      case 'input_text':
      case 'output_text': {
        parts.push({ type: CONTENT_TEXT, text: stringValue(m['text']), raw: m })
        break
      }
      case 'reasoning':
      case 'thinking':
      case 'reasoning_content': {
        const text = firstNonEmptyString(
          stringValue(m['text']),
          stringValue(m['thinking']),
          stringValue(m['content']),
        )
        if (text !== '') {
          parts.push({ type: CONTENT_REASONING, text, reasoning_text: text, thought: true, raw: m })
        }
        break
      }
      case 'image_url':
      case 'input_image':
      case 'image': {
        let url = ''
        const imageURL = asRecord(m['image_url'])
        if (imageURL) url = stringValue(imageURL['url'])
        if (url === '') url = stringValue(m['image_url'])
        parts.push({ type: CONTENT_IMAGE, image_url: url, raw: m })
        break
      }
      case 'input_audio':
      case 'audio':
      case 'audio_url':
      case 'output_audio': {
        let nested = asRecord(m['input_audio'])
        if (!nested) nested = asRecord(m['audio'])
        if (!nested) nested = asRecord(m['audio_url'])
        nested ??= {}
        parts.push({
          type: CONTENT_AUDIO,
          audio_url: firstNonEmptyString(stringValue(m['audio_url']), stringValue(nested['url']), stringValue(nested['audio_url'])),
          audio_base64: firstNonEmptyString(stringValue(m['data']), stringValue(nested['data']), stringValue(nested['audio_data'])),
          data: firstNonEmptyString(stringValue(m['data']), stringValue(nested['data']), stringValue(nested['audio_data'])),
          text: firstNonEmptyString(stringValue(m['transcript']), stringValue(nested['transcript'])),
          media_type: firstNonEmptyString(stringValue(m['format']), stringValue(m['mime_type']), stringValue(nested['format']), stringValue(nested['mime_type']), stringValue(nested['mimeType'])),
          raw: m,
        })
        break
      }
      case 'video_url':
      case 'input_video':
      case 'video': {
        let videoURL = stringValue(m['video_url'])
        const nested = asRecord(m['video_url'])
        if (nested) videoURL = stringValue(nested['url'])
        parts.push({ type: CONTENT_VIDEO, video_url: videoURL, uri: videoURL, raw: m })
        break
      }
      case 'input_file':
      case 'file': {
        const file = asRecord(m['file']) ?? {}
        parts.push({
          type: CONTENT_FILE,
          file_id: firstNonEmptyString(stringValue(m['file_id']), stringValue(file['file_id']), stringValue(file['id'])),
          file_name: firstNonEmptyString(stringValue(m['filename']), stringValue(file['filename']), stringValue(file['name'])),
          file_data: firstNonEmptyString(stringValue(m['file_data']), stringValue(file['file_data']), stringValue(file['data'])),
          uri: firstNonEmptyString(stringValue(m['file_url']), stringValue(file['file_url']), stringValue(file['url'])),
          raw: m,
        })
        break
      }
      case 'document': {
        parts.push({
          type: CONTENT_DOCUMENT,
          file_id: stringValue(m['file_id']),
          file_name: stringValue(m['filename']),
          file_data: stringValue(m['file_data']),
          raw: m,
        })
        break
      }
      case 'refusal': {
        parts.push({ type: CONTENT_REFUSAL, text: firstNonEmptyString(stringValue(m['refusal']), stringValue(m['text'])), raw: m })
        break
      }
      case 'tool_result':
      case 'function_response': {
        parts.push({
          type: CONTENT_TOOL_OUTPUT,
          tool_call_id: firstNonEmptyString(stringValue(m['tool_call_id']), stringValue(m['call_id'])),
          tool_output: firstNonEmptyString(contentValueToString(m['content']), contentValueToString(m['output']), contentValueToString(m['response'])),
          raw: m,
        })
        break
      }
      default: {
        parts.push({ type: t, raw: m })
      }
    }
  }
  return parts
}

/** 拼接全部 text 部件（Go maheshvaraText）。 */
export function maheshvaraText(parts: MaheshvaraContentPart[] | undefined): string {
  let out = ''
  for (const part of parts ?? []) {
    if (part.type === CONTENT_TEXT) out += part.text ?? ''
  }
  return out
}

/**
 * 汇总 instructions：请求显式 instructions + 全部 system/developer 消息文本，
 * 以空行连接（Go maheshvaraResponsesInstructions，Claude/Gemini/Responses 编码共用）。
 */
export function collectInstructions(req: MaheshvaraRequest | undefined): string {
  if (!req) return ''
  const parts: string[] = []
  const instructions = (req.instructions ?? '').trim()
  if (instructions !== '') parts.push(instructions)
  for (const msg of req.messages ?? []) {
    const role = (msg.role ?? '').trim().toLowerCase()
    if (role !== 'system' && role !== 'developer') continue
    const text = maheshvaraText(msg.content).trim()
    if (text !== '') parts.push(text)
  }
  return parts.join('\n\n')
}

/**
 * 多键名兜底提取 usage（Go maheshvara_stream.go maheshvaraUsageFromRawMap）。
 * 各协议流式 chunk 的 usage 字段名不同（input_tokens/prompt_tokens/promptTokenCount 等），
 * 按候选键顺序取第一个非空值；四个流式解码器共用。
 */
export function usageFromRawMap(raw: Record<string, unknown> | undefined): MaheshvaraUsage | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined
  const usage: MaheshvaraUsage = {
    input_tokens: intValue(firstNonValue(raw, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount'])),
    output_tokens: intValue(firstNonValue(raw, ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount'])),
    total_tokens: intValue(firstNonValue(raw, ['total_tokens', 'totalTokens', 'totalTokenCount'])),
    // P2-13：嵌套回退——OpenAI 流式 chunk 的 usage.prompt_tokens_details.cached_tokens
    // 与 Responses 流式的 input_tokens_details.cached_tokens 藏在明细对象里，
    // 平铺键取不到（非流式路径各协议 decode 已处理嵌套）。
    cached_input_tokens: intValue(firstNonValue(raw, ['cached_tokens', 'cachedInputTokens', 'cachedContentTokenCount']))
      || intValue(asRecordLike(raw['prompt_tokens_details'])?.['cached_tokens'])
      || intValue(asRecordLike(raw['input_tokens_details'])?.['cached_tokens'])
      || undefined,
    reasoning_tokens: intValue(firstNonValue(raw, ['reasoning_tokens', 'reasoningTokens', 'thoughtsTokenCount'])) || undefined,
    source: 'provider_stream',
  }
  if (usage.total_tokens === 0) {
    usage.total_tokens = usage.input_tokens + usage.output_tokens
  }
  return usage
}

function asRecordLike(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
