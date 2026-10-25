/**
 * OpenAI Responses SSE 流 → maheshvara 流事件。
 * 逐行为对齐 maheshvara_stream_decoder_responses.go。
 * 复用 decodeResponsesResponse 完成 response/item/part 三级对象的 maheshvara 化。
 */

import type { MaheshvaraContentPart, MaheshvaraOutputItem, MaheshvaraResponse, MaheshvaraStreamEvent, SSEEvent } from '@elysia-ai/maheshvara'
import {
  EVENT_FUNCTION_CALL_ARGUMENTS_DELTA,
  EVENT_FUNCTION_CALL_ARGUMENTS_DONE,
  EVENT_REASONING_SIGNATURE_DELTA,
  EVENT_REFUSAL_DELTA,
  EVENT_REFUSAL_DONE,
  EVENT_RESPONSE_COMPLETED,
  EVENT_RESPONSE_CREATED,
  EVENT_RESPONSE_FAILED,
  EVENT_RESPONSE_IN_PROGRESS,
  EVENT_REASONING_DELTA,
  EVENT_REASONING_DONE,
  EVENT_TEXT_DELTA,
  EVENT_TEXT_DONE,
  EVENT_USAGE_DELTA,
  OUTPUT_FUNCTION_CALL,
  SIGNATURE_PROVIDER_OPENAI,
} from '@elysia-ai/maheshvara'
import { asRecord, classFromOpenAIType, firstNonEmptyString, int64Value, intValue, stringValue, usageFromRawMap } from '@elysia-ai/maheshvara'
import { decodeResponsesResponse } from './decode.js'

function responsesMapToMaheshvara(raw: Record<string, unknown> | undefined): MaheshvaraResponse | undefined {
  if (!raw) return undefined
  return decodeResponsesResponse(raw)
}

function responsesOutputMapToMaheshvara(raw: Record<string, unknown> | undefined): MaheshvaraOutputItem | undefined {
  if (!raw) return undefined
  const response = responsesMapToMaheshvara({
    id: 'stream', object: 'response', status: 'in_progress', created_at: 0, model: '', output: [raw],
  })
  return response?.output?.[0]
}

function responsesContentMapToMaheshvara(raw: Record<string, unknown> | undefined): MaheshvaraContentPart | undefined {
  if (!raw) return undefined
  const item = responsesOutputMapToMaheshvara({
    id: 'stream_part', type: 'message', status: 'in_progress', role: 'assistant', content: [raw],
  })
  return item?.content?.[0]
}

export class ResponsesStreamDecoder {
  private responseID = ''
  private model = ''
  private terminal = false
  private sawWireEvent = false
  private sawOutput = false
  private sawFinishReason = false

  getTerminal(): boolean {
    return this.terminal
  }

  getSawWireEvent(): boolean {
    return this.sawWireEvent
  }

  getSawOutput(): boolean {
    return this.sawOutput
  }

  /** 上游是否发过真实终态（response.completed），区别于合成 [DONE]。 */
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

    const events = this.decodeResponses(raw)
    for (const item of events) {
      if (!item.response_id) item.response_id = this.responseID
      if (!item.model) item.model = this.model
      if ((item.delta ?? '') !== '' || (item.reasoning_delta ?? '') !== '' || (item.refusal_delta ?? '') !== ''
        || (item.tool_arguments_delta ?? '') !== '' || item.content_part !== undefined || item.output_item !== undefined) {
        this.sawOutput = true
      }
    }
    return events
  }

  private decodeResponses(raw: Record<string, unknown>): MaheshvaraStreamEvent[] {
    const typeName = stringValue(raw['type'])
    const responseValue = asRecord(raw['response'])
    this.responseID = firstNonEmptyString(stringValue(raw['response_id']), responseValue ? stringValue(responseValue['id']) : '', this.responseID)
    this.model = firstNonEmptyString(stringValue(raw['model']), responseValue ? stringValue(responseValue['model']) : '', this.model)
    const event = this.baseEvent(typeName, raw)
    event.item_id = stringValue(raw['item_id']) || undefined
    event.output_index = intValue(raw['output_index'])
    event.content_index = intValue(raw['content_index'])
    event.sequence = int64Value(raw['sequence_number'])
    event.status = responseValue ? stringValue(responseValue['status']) || undefined : undefined

    switch (typeName) {
      case EVENT_RESPONSE_CREATED:
      case EVENT_RESPONSE_IN_PROGRESS: {
        if (responseValue) {
          event.response = responsesMapToMaheshvara(responseValue)
        }
        return [event]
      }
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const item = responsesOutputMapToMaheshvara(asRecord(raw['item']))
        if (!item) return []
        event.output_item = item
        if (item.type === OUTPUT_FUNCTION_CALL) {
          event.tool_call_id = item.call_id
          event.tool_name = item.name
          event.tool_arguments_done = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? '')
          event.tool_call_index = event.output_index
        }
        return [event]
      }
      case 'response.content_part.added':
      case 'response.content_part.done': {
        const part = responsesContentMapToMaheshvara(asRecord(raw['part']))
        if (!part) return []
        event.content_part = part
        return [event]
      }
      case EVENT_TEXT_DELTA:
        event.delta = stringValue(raw['delta'])
        return [event]
      case EVENT_TEXT_DONE:
        event.text_done = firstNonEmptyString(stringValue(raw['text']), stringValue(raw['content']), stringValue(raw['delta']))
        return [event]
      case EVENT_REFUSAL_DELTA:
        event.refusal_delta = stringValue(raw['delta'])
        return [event]
      case EVENT_REFUSAL_DONE:
        event.refusal_done = firstNonEmptyString(stringValue(raw['refusal']), stringValue(raw['text']), stringValue(raw['delta']))
        return [event]
      case EVENT_REASONING_DELTA:
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        event.reasoning_delta = stringValue(raw['delta'])
        return [event]
      case EVENT_REASONING_DONE:
      case 'response.reasoning_summary_text.done':
      case 'response.reasoning_text.done':
        event.reasoning_done = firstNonEmptyString(stringValue(raw['text']), stringValue(raw['delta']), stringValue(raw['content']))
        return [event]
      case EVENT_REASONING_SIGNATURE_DELTA:
      case 'response.reasoning_signature.done': {
        // 此前落入 default 且按 "reasoning" 前缀被误当推理文本拼接。
        const signature = firstNonEmptyString(stringValue(raw['delta']), stringValue(raw['signature']), stringValue(raw['text']))
        if (signature === '') return []
        event.type = EVENT_REASONING_SIGNATURE_DELTA
        event.reasoning_signature_delta = signature
        event.reasoning_signature_provider = firstNonEmptyString(stringValue(raw['provider']), SIGNATURE_PROVIDER_OPENAI)
        return [event]
      }
      case EVENT_FUNCTION_CALL_ARGUMENTS_DELTA:
        event.tool_call_id = stringValue(raw['call_id']) || undefined
        event.tool_name = stringValue(raw['name']) || undefined
        event.tool_arguments_delta = stringValue(raw['delta'])
        event.tool_call_index = event.output_index
        return [event]
      case EVENT_FUNCTION_CALL_ARGUMENTS_DONE:
        event.tool_call_id = stringValue(raw['call_id']) || undefined
        event.tool_name = stringValue(raw['name']) || undefined
        event.tool_arguments_done = firstNonEmptyString(stringValue(raw['arguments']), stringValue(raw['delta']))
        event.tool_call_index = event.output_index
        return [event]
      case EVENT_USAGE_DELTA:
        event.usage = usageFromRawMap(asRecord(raw['usage']))
        return [event]
      case EVENT_RESPONSE_COMPLETED: {
        this.terminal = true
        this.sawFinishReason = true
        if (responseValue) {
          const response = responsesMapToMaheshvara(responseValue)
          if (!response) return []
          event.response = response
          event.finish_reason = response.stop_reason
          if (response.usage) {
            const usageEvent = this.baseEvent(EVENT_USAGE_DELTA, raw)
            usageEvent.usage = response.usage
            return [usageEvent, event]
          }
        }
        return [event]
      }
      case EVENT_RESPONSE_FAILED:
      case 'response.incomplete':
      case 'error': {
        this.terminal = true
        let errorValue = asRecord(raw['error'])
        if (!errorValue && responseValue) errorValue = asRecord(responseValue['error'])
        errorValue ??= {}
        event.type = EVENT_RESPONSE_FAILED
        const errType = stringValue(errorValue['type'])
        event.error = {
          message: firstNonEmptyString(stringValue(errorValue['message']), 'OpenAI Responses stream failed'),
          type: errType || undefined,
          class: classFromOpenAIType(errType),
          code: stringValue(errorValue['code']) || undefined,
          param: stringValue(errorValue['param']) || undefined,
          raw: errorValue,
        }
        return [event]
      }
      default: {
        if (typeName.includes('function_call')) {
          event.tool_call_id = stringValue(raw['call_id']) || undefined
          event.tool_name = stringValue(raw['name']) || undefined
          event.tool_arguments_delta = stringValue(raw['delta']) || undefined
          event.tool_arguments_done = stringValue(raw['arguments']) || undefined
        }
        if (typeName.includes('reasoning')) {
          event.reasoning_delta = stringValue(raw['delta']) || undefined
        }
        if (typeName === '') return []
        return [event]
      }
    }
  }
}
