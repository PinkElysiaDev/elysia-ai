/**
 * Gemini SSE 流 → maheshvara 流事件。
 * 逐行为对齐 maheshvara_stream_decoder_gemini.go。
 * 注意：Gemini 流式（streamGenerateContent，alt=sse）每个 chunk 都是
 * 一个完整的 GenerateContentResponse。
 */

import type { MaheshvaraContentPart, MaheshvaraStreamEvent, SSEEvent } from '@elysia-ai/maheshvara'
import {
  ANNOTATION_GEMINI_GROUNDING,
  CONTENT_FILE,
  CONTENT_IMAGE,
  CONTENT_TEXT,
  CONTENT_TOOL_OUTPUT,
  ERROR_CLASS_INVALID_REQUEST,
  EVENT_CONTENT_PART_ADDED,
  EVENT_FUNCTION_CALL_ADDED,
  EVENT_FUNCTION_CALL_ARGUMENTS_DONE,
  EVENT_REASONING_SIGNATURE_DELTA,
  EVENT_RESPONSE_COMPLETED,
  EVENT_RESPONSE_FAILED,
  EVENT_TEXT_DELTA,
  EVENT_USAGE_DELTA,
  SIGNATURE_PROVIDER_GEMINI,
} from '@elysia-ai/maheshvara'
import {
  asArray,
  asRecord,
  boolValue,
  contentValueToString,
  firstNonEmptyString,
  firstNonNilValue,
  intValue,
  stringValue,
  usageFromRawMap,
} from '@elysia-ai/maheshvara'

function maheshvaraMediaContentType(mediaType: string): string {
  if (mediaType.startsWith('image/')) return CONTENT_IMAGE
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  return CONTENT_FILE
}

function geminiStreamMediaPart(part: Record<string, unknown>): MaheshvaraContentPart | undefined {
  const inline = asRecord(firstNonNilValue(part['inlineData'], part['inline_data']))
  if (inline) {
    const mediaType = firstNonEmptyString(stringValue(inline['mimeType']), stringValue(inline['mime_type']))
    return {
      type: maheshvaraMediaContentType(mediaType),
      data: stringValue(inline['data']),
      media_type: mediaType || undefined,
      mime_type: mediaType || undefined,
      raw: part,
    }
  }
  const file = asRecord(firstNonNilValue(part['fileData'], part['file_data']))
  if (file) {
    const mediaType = firstNonEmptyString(stringValue(file['mimeType']), stringValue(file['mime_type']))
    return {
      type: maheshvaraMediaContentType(mediaType),
      uri: firstNonEmptyString(stringValue(file['fileUri']), stringValue(file['file_uri'])) || undefined,
      media_type: mediaType || undefined,
      mime_type: mediaType || undefined,
      raw: part,
    }
  }
  return undefined
}

export class GeminiStreamDecoder {
  private responseID = ''
  private model = ''
  private terminal = false
  private sawWireEvent = false
  private sawOutput = false
  private sawFinishReason = false
  private nextSyntheticCallID = 0
  // P2-15：跨 chunk 单调 part 计数器（per choice）——partIndex 是 chunk 内
  // 序号（每块从 0 重计），消费端按 (choice_index, content_index) 聚合时
  // 不同 chunk 的 part 0 会被误并为同一 part。
  private readonly nextPartIndex = new Map<number, number>()
  private readonly finishedChoices = new Set<number>()
  private readonly seenChoices = new Set<number>()

  getTerminal(): boolean {
    return this.terminal
  }

  getSawWireEvent(): boolean {
    return this.sawWireEvent
  }

  getSawOutput(): boolean {
    return this.sawOutput
  }

  /** 上游是否发过真实终态原因（区别于合成 [DONE] 终态）。 */
  getSawFinishReason(): boolean {
    return this.sawFinishReason
  }

  private baseEvent(type: string, raw: Record<string, unknown>): MaheshvaraStreamEvent {
    return { type, response_id: this.responseID, model: this.model, raw }
  }

  decode(event: SSEEvent): MaheshvaraStreamEvent[] {
    const data = event.data.trim()
    if (data === '') return []
    this.sawWireEvent = true
    if (data === '[DONE]') {
      if (this.terminal) return []
      this.terminal = true
      return [{ type: EVENT_RESPONSE_COMPLETED, response_id: this.responseID, model: this.model }]
    }
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(data) as Record<string, unknown>
    } catch (error) {
      throw new Error(`decode SSE JSON event: ${(error as Error).message}`)
    }
    if (!asRecord(raw)) return []
    if (stringValue(raw['type']) === '' && event.event.trim() !== '') {
      raw['type'] = event.event.trim()
    }

    const events = this.decodeGemini(raw)
    for (const item of events) {
      if (!item.response_id) item.response_id = this.responseID
      if (!item.model) item.model = this.model
      if ((item.delta ?? '') !== '' || (item.reasoning_delta ?? '') !== '' || item.content_part !== undefined) {
        this.sawOutput = true
      }
    }
    return events
  }

  private allChoicesFinished(): boolean {
    for (const index of this.seenChoices) {
      if (!this.finishedChoices.has(index)) return false
    }
    return true
  }

  private decodeGemini(raw: Record<string, unknown>): MaheshvaraStreamEvent[] {
    this.responseID = firstNonEmptyString(stringValue(raw['responseId']), this.responseID)
    this.model = firstNonEmptyString(stringValue(raw['modelVersion']), this.model)
    const events: MaheshvaraStreamEvent[] = []
    const usage = usageFromRawMap(asRecord(raw['usageMetadata']))
    if (usage) {
      const usageEvent = this.baseEvent(EVENT_USAGE_DELTA, raw)
      usageEvent.usage = usage
      events.push(usageEvent)
    }

    const candidates = asArray(raw['candidates']) ?? []
    for (const candidateValue of candidates) {
      const candidate = asRecord(candidateValue)
      if (!candidate) continue
      const choiceIndex = intValue(candidate['index'])
      this.seenChoices.add(choiceIndex)
      // 搜索/据实来源标注随 candidate 到达：挂到同 chunk 首个文本事件上，
      // 渲染层据此回写 candidate.groundingMetadata。
      const grounding = asRecord(candidate['groundingMetadata'])
      let groundingEmitted = false
      const content = asRecord(candidate['content']) ?? {}
      const parts = asArray(content['parts']) ?? []
      parts.forEach((partValue, chunkPartIndex) => {
        const part = asRecord(partValue)
        if (!part) return
        const partIndex = this.nextPartIndex.get(choiceIndex) ?? 0
        this.nextPartIndex.set(choiceIndex, partIndex + 1)
        const signature = firstNonEmptyString(stringValue(part['thoughtSignature']), stringValue(part['thought_signature']))
        if (signature !== '') {
          const signatureEvent = this.baseEvent(EVENT_REASONING_SIGNATURE_DELTA, raw)
          signatureEvent.choice_index = choiceIndex
          signatureEvent.content_index = partIndex
          signatureEvent.reasoning_signature_delta = signature
          signatureEvent.reasoning_signature_provider = SIGNATURE_PROVIDER_GEMINI
          events.push(signatureEvent)
        }
        const text = stringValue(part['text'])
        if (text !== '') {
          const textEvent = this.baseEvent(EVENT_TEXT_DELTA, raw)
          textEvent.choice_index = choiceIndex
          textEvent.content_index = partIndex
          if (boolValue(part['thought'])) {
            textEvent.type = 'response.reasoning.delta'
            textEvent.reasoning_delta = text
          } else {
            textEvent.delta = text
            if (!groundingEmitted && grounding) {
              groundingEmitted = true
              textEvent.annotations = [{ [ANNOTATION_GEMINI_GROUNDING]: grounding }]
            }
          }
          events.push(textEvent)
        }
        const functionCall = asRecord(part['functionCall'])
        if (functionCall) {
          // 合成 id 用解码器级单调计数器：partIndex 是 chunk 内序号（每块
          // 从 0 重新计），跨 chunk 的两个无 id 调用会撞成 call_0_0。
          const callID = firstNonEmptyString(stringValue(functionCall['id']), `call_syn_${this.nextSyntheticCallID}`)
          this.nextSyntheticCallID++
          const name = stringValue(functionCall['name'])
          const added = this.baseEvent(EVENT_FUNCTION_CALL_ADDED, raw)
          added.choice_index = choiceIndex
          added.content_index = partIndex
          added.tool_call_index = partIndex
          added.tool_call_id = callID
          added.tool_name = name
          events.push(added)
          const done = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DONE, raw)
          done.choice_index = choiceIndex
          done.content_index = partIndex
          done.tool_call_index = partIndex
          done.tool_call_id = callID
          done.tool_name = name
          done.tool_arguments_done = JSON.stringify(firstNonNilValue(functionCall['args'], {}))
          events.push(done)
        }
        const functionResponse = asRecord(part['functionResponse'])
        if (functionResponse) {
          const maheshvaraPart: MaheshvaraContentPart = {
            type: CONTENT_TOOL_OUTPUT,
            tool_call_id: firstNonEmptyString(stringValue(functionResponse['id']), stringValue(functionResponse['name'])),
            tool_output: contentValueToString(functionResponse['response']),
            raw: functionResponse,
          }
          const responseEvent = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
          responseEvent.choice_index = choiceIndex
          responseEvent.content_index = partIndex
          responseEvent.content_part = maheshvaraPart
          events.push(responseEvent)
        }
        const mediaPart = geminiStreamMediaPart(part)
        if (mediaPart) {
          const mediaEvent = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
          mediaEvent.choice_index = choiceIndex
          mediaEvent.content_index = partIndex
          mediaEvent.content_part = mediaPart
          events.push(mediaEvent)
        }
        const executable = asRecord(part['executableCode'])
        if (executable) {
          const codePart: MaheshvaraContentPart = {
            type: 'executable_code',
            text: stringValue(executable['code']),
            metadata: { language: executable['language'] },
            raw: part,
          }
          const codeEvent = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
          codeEvent.choice_index = choiceIndex
          codeEvent.content_index = partIndex
          codeEvent.content_part = codePart
          events.push(codeEvent)
        }
        const execution = asRecord(part['codeExecutionResult'])
        if (execution) {
          const resultPart: MaheshvaraContentPart = {
            type: 'code_execution_result',
            text: stringValue(execution['output']),
            metadata: { outcome: execution['outcome'] },
            raw: part,
          }
          const resultEvent = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
          resultEvent.choice_index = choiceIndex
          resultEvent.content_index = partIndex
          resultEvent.content_part = resultPart
          events.push(resultEvent)
        }
      })
      const finishReason = stringValue(candidate['finishReason'])
      if (finishReason !== '') {
        this.sawFinishReason = true
        this.finishedChoices.add(choiceIndex)
        const completedEvent = this.baseEvent(EVENT_RESPONSE_COMPLETED, raw)
        completedEvent.choice_index = choiceIndex
        completedEvent.finish_reason = finishReason
        events.push(completedEvent)
      }
    }
    if (this.seenChoices.size > 0 && this.allChoicesFinished()) {
      this.terminal = true
    }
    if (candidates.length === 0) {
      const feedback = asRecord(raw['promptFeedback'])
      if (feedback && stringValue(feedback['blockReason']) !== '') {
        this.terminal = true
        const failedEvent = this.baseEvent(EVENT_RESPONSE_FAILED, raw)
        failedEvent.error = {
          message: `Gemini request blocked: ${stringValue(feedback['blockReason'])}`,
          type: 'content_filter',
          class: ERROR_CLASS_INVALID_REQUEST,
          raw: feedback,
        }
        events.push(failedEvent)
      }
    }
    return events
  }
}
