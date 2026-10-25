/**
 * Anthropic Messages wire 响应 → maheshvara。
 * 对齐 maheshvara_convert.go 的 ClaudeResponseToMaheshvara / maheshvaraUsageFromClaudeUsage，
 * 以及 maheshvara_extensions.go 的 claudeImageBlockToPart / claudeDocumentBlockToPart /
 * claudeMediaBlockToPart。
 */

import type { MaheshvaraContentPart, MaheshvaraOutputItem, MaheshvaraResponse, MaheshvaraUsage } from '@elysia-ai/maheshvara'
import {
  CONTENT_AUDIO,
  CONTENT_DOCUMENT,
  CONTENT_FILE,
  CONTENT_IMAGE,
  CONTENT_REASONING,
  CONTENT_TEXT,
  CONTENT_TOOL_OUTPUT,
  CONTENT_VIDEO,
  OUTPUT_FUNCTION_CALL,
  OUTPUT_MESSAGE,
  OUTPUT_REASONING,
  SIGNATURE_PROVIDER_ANTHROPIC,
  SIGNATURE_PROVIDER_MAHESHVARA,
} from '@elysia-ai/maheshvara'
import {
  asArray,
  asRecord,
  contentValueToString,
  decodeMaheshvaraReasoningEnvelope,
  firstNonEmptyString,
  intValue,
  stringValue,
} from '@elysia-ai/maheshvara'

function newMaheshvaraResponseID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
}

/** Claude image block（{"source":{...}}）→ maheshvara 图片部件。 */
export function claudeImageBlockToPart(block: Record<string, unknown>): MaheshvaraContentPart {
  const part: MaheshvaraContentPart = { type: CONTENT_IMAGE, raw: block }
  const source = asRecord(block['source'])
  if (!source) return part
  switch (stringValue(source['type'])) {
    case 'base64':
      part.media_type = firstNonEmptyString(stringValue(source['media_type']), stringValue(source['mimeType']))
      part.image_base64 = stringValue(source['data'])
      break
    case 'url':
      part.image_url = stringValue(source['url'])
      break
    default: {
      // 未声明 type 时从字段推断（data→base64，url→url）。
      const data = stringValue(source['data'])
      if (data !== '') {
        part.media_type = firstNonEmptyString(stringValue(source['media_type']), stringValue(source['mimeType']))
        part.image_base64 = data
      } else {
        const uri = stringValue(source['url'])
        if (uri !== '') part.image_url = uri
      }
    }
  }
  return part
}

export function claudeDocumentBlockToPart(block: Record<string, unknown>): MaheshvaraContentPart {
  const part: MaheshvaraContentPart = { type: CONTENT_DOCUMENT, raw: block }
  const source = asRecord(block['source'])
  if (source) {
    part.media_type = firstNonEmptyString(stringValue(source['media_type']), stringValue(source['mimeType']))
    part.mime_type = part.media_type
    part.file_data = stringValue(source['data'])
    part.file_id = stringValue(source['file_id'])
    part.file_name = stringValue(source['filename'])
    part.uri = firstNonEmptyString(stringValue(source['url']), stringValue(source['file_uri']))
  }
  part.file_name = firstNonEmptyString(part.file_name ?? '', stringValue(block['name']), stringValue(block['filename']))
  return part
}

export function claudeMediaBlockToPart(block: Record<string, unknown>, partType: string): MaheshvaraContentPart {
  const part: MaheshvaraContentPart = { type: partType, raw: block }
  const source = asRecord(block['source'])
  if (source) {
    part.media_type = firstNonEmptyString(stringValue(source['media_type']), stringValue(source['mimeType']))
    part.mime_type = part.media_type
    part.data = stringValue(source['data'])
    part.uri = firstNonEmptyString(stringValue(source['url']), stringValue(source['file_uri']))
  }
  return part
}

function usageFromClaude(usage: Record<string, unknown> | undefined): MaheshvaraUsage | undefined {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0, source: 'provider_response' }
  }
  const cacheCreation = asRecord(usage['cache_creation']) ?? {}
  let input = intValue(usage['input_tokens'])
    + intValue(usage['cache_read_input_tokens'])
    + intValue(usage['cache_creation_input_tokens'])
  if (intValue(usage['cache_creation_input_tokens']) === 0) {
    // 官方响应里 cache_creation.ephemeral_* 是 cache_creation_input_tokens 的
    // 明细拆分，两者同时返回且相等；只在总数缺失时才用明细求和，避免双重计入。
    input += intValue(cacheCreation['ephemeral_5m_input_tokens'])
      + intValue(cacheCreation['ephemeral_1h_input_tokens'])
  }
  const output = intValue(usage['output_tokens'])
  const serverToolUse = asRecord(usage['server_tool_use'])
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cached_input_tokens: intValue(usage['cache_read_input_tokens']) || undefined,
    cache_creation_input_tokens: intValue(usage['cache_creation_input_tokens']) || undefined,
    // 双 TTL 桶明细保真（ephemeral_5m / ephemeral_1h）。
    cache_creation_5m_tokens: cacheCreation ? intValue(cacheCreation['ephemeral_5m_input_tokens']) || undefined : undefined,
    cache_creation_1h_tokens: cacheCreation ? intValue(cacheCreation['ephemeral_1h_input_tokens']) || undefined : undefined,
    web_search_call_count: serverToolUse ? intValue(serverToolUse['web_search_requests']) || undefined : undefined,
    source: 'provider_response',
  }
}

/** Anthropic Messages 响应（JSON.parse 产物）→ maheshvara 响应。 */
export function decodeMessagesResponse(body: unknown): MaheshvaraResponse {
  const raw = asRecord(body)
  if (!raw) throw new Error('nil Claude response')

  const out: MaheshvaraResponse = {
    id: stringValue(raw['id']),
    model: stringValue(raw['model']),
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    output: [],
    stop_reason: stringValue(raw['stop_reason']) || undefined,
    usage: usageFromClaude(asRecord(raw['usage'])),
  }
  const msg: MaheshvaraOutputItem = { id: stringValue(raw['id']), type: OUTPUT_MESSAGE, status: 'completed', role: 'assistant', content: [] }
  // 按 block 原始出现顺序输出：遇到 thinking/tool_use 等独立 item 前先冲刷
  // 已累积的 message。Anthropic 要求启用 thinking 时 thinking 块必须是 assistant
  // 消息的第一块；若把 msg 一律前插，[thinking, text] 会变成 [text, thinking]，
  // Claude→maheshvara→Claude 往返即违反约束。
  const flushMsg = (): void => {
    if ((msg.content?.length ?? 0) > 0) {
      // 推送副本再重置：避免同一引用被后续块继续写入（Go 侧 flush 后
      // 新建 msg 对象）。
      out.output?.push({ ...msg, content: msg.content })
      msg.content = []
    }
  }
  for (const blockValue of asArray(raw['content']) ?? []) {
    const block = asRecord(blockValue)
    if (!block) continue
    switch (stringValue(block['type'])) {
      case 'text': {
        const part: MaheshvaraContentPart = { type: CONTENT_TEXT, text: stringValue(block['text']), raw: block }
        const citations = asArray(block['citations'])
        if (citations && citations.length > 0) {
          const citationRecords = citations.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== undefined)
          if (citationRecords.length > 0) part.citations = citationRecords
        }
        msg.content?.push(part)
        break
      }
      case 'thinking': {
        flushMsg()
        const part: MaheshvaraContentPart = {
          type: CONTENT_REASONING,
          reasoning_text: stringValue(block['thinking']),
          text: stringValue(block['thinking']),
          signature: stringValue(block['signature']) || undefined,
          signature_provider: SIGNATURE_PROVIDER_ANTHROPIC,
        }
        const envelope = decodeMaheshvaraReasoningEnvelope(stringValue(block['signature']))
        if (envelope) {
          part.signature = undefined
          part.signature_provider = SIGNATURE_PROVIDER_MAHESHVARA
          part.encrypted_content = envelope.encrypted_content
          part.encrypted_provider = envelope.provider
          part.encrypted_model = envelope.model
          part.reasoning_summary = envelope.summary
          if (!part.text) {
            part.text = envelope.text ?? ''
            part.reasoning_text = envelope.text ?? ''
          }
        }
        out.output?.push({
          id: newMaheshvaraResponseID('rs'),
          type: OUTPUT_REASONING,
          status: 'completed',
          content: [part],
        })
        break
      }
      case 'redacted_thinking': {
        flushMsg()
        const envelope = decodeMaheshvaraReasoningEnvelope(stringValue(block['data']))
        if (envelope) {
          out.output?.push({
            id: newMaheshvaraResponseID('rs'), type: OUTPUT_REASONING, status: 'completed',
            content: [{
              type: CONTENT_REASONING, text: envelope.text ?? '', reasoning_text: envelope.text ?? '',
              signature_provider: SIGNATURE_PROVIDER_MAHESHVARA,
              encrypted_content: envelope.encrypted_content,
              encrypted_provider: envelope.provider,
              encrypted_model: envelope.model,
              reasoning_summary: envelope.summary,
            }],
          })
        }
        break
      }
      case 'tool_use':
        flushMsg()
        out.output?.push({
          id: stringValue(block['id']),
          type: OUTPUT_FUNCTION_CALL,
          status: 'completed',
            call_id: stringValue(block['id']),
          name: stringValue(block['name']),
          // P2-17：canonical 统一为 JSON 字符串（openai/gemini 同为字符串）——
          // 此前透传对象，跨 provider 回灌时被 encode 侧静默变 '{}'。
          arguments: JSON.stringify(block['input'] ?? {}),
        })
        break
      case 'image':
        msg.content?.push(claudeImageBlockToPart({ type: 'image', source: block['source'] }))
        break
      case 'document':
      case 'file':
        msg.content?.push(claudeDocumentBlockToPart({ type: stringValue(block['type']), source: block['source'] }))
        break
      case 'tool_result':
        msg.content?.push({
          type: CONTENT_TOOL_OUTPUT,
          tool_call_id: stringValue(block['tool_use_id']),
          tool_output: contentValueToString(block['content']),
          raw: block,
        })
        break
      default: {
        // server_tool_use / web_search_tool_result 等服务端工具块与未知块：
        // 整块原样保留（raw 为完整原始对象），Claude 目标渲染时整块回放；
        // 跨协议目标按未知 part 处理。
        const blockType = stringValue(block['type'])
        if (blockType !== '') msg.content?.push({ type: blockType, raw: block })
        break
      }
    }
  }
  flushMsg()
  return out
}

/** 提取全部消息文本（网关 output 用）。 */
export function extractMessageText(response: MaheshvaraResponse): string {
  let out = ''
  for (const item of response.output ?? []) {
    if (item.type !== OUTPUT_MESSAGE) continue
    for (const part of item.content ?? []) {
      if (part.type === CONTENT_TEXT) out += part.text ?? ''
    }
  }
  return out
}

export { usageFromClaude, CONTENT_AUDIO, CONTENT_VIDEO, CONTENT_FILE }
