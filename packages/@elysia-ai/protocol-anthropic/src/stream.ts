/**
 * Anthropic Messages SSE 流 → maheshvara 流事件。
 * 逐行为对齐 maheshvara_stream_decoder_anthropic.go。
 * 块状态（tool_use 参数累积）跨事件维护。
 */

import type {
  MaheshvaraUsage, MaheshvaraContentPart, MaheshvaraStreamEvent, SSEEvent } from '@elysia-ai/maheshvara'
import {
  CONTENT_REASONING,
  CONTENT_TEXT,
  EVENT_ANNOTATION_DELTA,
  EVENT_CONTENT_PART_ADDED,
  EVENT_FUNCTION_CALL_ADDED,
  EVENT_FUNCTION_CALL_ARGUMENTS_DELTA,
  EVENT_FUNCTION_CALL_ARGUMENTS_DONE,
  EVENT_OUTPUT_ITEM_DONE,
  EVENT_REASONING_DELTA,
  EVENT_REASONING_SIGNATURE_DELTA,
  EVENT_RESPONSE_COMPLETED,
  EVENT_RESPONSE_CREATED,
  EVENT_RESPONSE_FAILED,
  EVENT_TEXT_DELTA,
  EVENT_USAGE_DELTA,
  SIGNATURE_PROVIDER_ANTHROPIC,
  SIGNATURE_PROVIDER_MAHESHVARA,
} from '@elysia-ai/maheshvara'
import {
  asRecord,
  classFromAnthropicType,
  decodeMaheshvaraReasoningEnvelope,
  firstNonEmptyString,
  intValue,
  stringValue,
  usageFromRawMap,
} from '@elysia-ai/maheshvara'

interface AnthropicBlock {
  typeName: string
  id: string
  name: string
  arguments: string
}

export class AnthropicStreamDecoder {
  private responseID = ''
  private model = ''
  private terminal = false
  private sawWireEvent = false
  private sawOutput = false
  private readonly blocks = new Map<number, AnthropicBlock>()
  // P2-12：usage 快照累计——message_start 带 input_tokens，message_delta 只带
  // 累积 output_tokens。不合并则消费端"取最后一条"丢 input、"逐条相加"双计 output。
  private lastUsage?: MaheshvaraUsage

  getTerminal(): boolean {
    return this.terminal
  }

  getSawWireEvent(): boolean {
    return this.sawWireEvent
  }

  getSawOutput(): boolean {
    return this.sawOutput
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

    const events = this.decodeAnthropic(raw)
    for (const item of events) {
      if (!item.response_id) item.response_id = this.responseID
      if (!item.model) item.model = this.model
      if ((item.delta ?? '') !== '' || (item.reasoning_delta ?? '') !== '' || item.content_part !== undefined) {
        this.sawOutput = true
      }
    }
    return events
  }

  private decodeAnthropic(raw: Record<string, unknown>): MaheshvaraStreamEvent[] {
    const typeName = stringValue(raw['type'])
    const events: MaheshvaraStreamEvent[] = []
    switch (typeName) {
      case 'message_start': {
        const message = asRecord(raw['message']) ?? {}
        this.responseID = firstNonEmptyString(stringValue(message['id']), this.responseID)
        this.model = firstNonEmptyString(stringValue(message['model']), this.model)
        const event = this.baseEvent(EVENT_RESPONSE_CREATED, raw)
        event.role = firstNonEmptyString(stringValue(message['role']), 'assistant')
        event.status = 'in_progress'
        events.push(event)
        const usage = usageFromRawMap(asRecord(message['usage']))
        if (usage) {
          this.lastUsage = { ...usage }
          const usageEvent = this.baseEvent(EVENT_USAGE_DELTA, raw)
          usageEvent.usage = usage
          events.push(usageEvent)
        }
        break
      }
      case 'content_block_start': {
        const index = intValue(raw['index'])
        const blockValue = asRecord(raw['content_block']) ?? {}
        const block: AnthropicBlock = {
          typeName: stringValue(blockValue['type']),
          id: firstNonEmptyString(stringValue(blockValue['id']), stringValue(raw['content_block_id'])),
          name: stringValue(blockValue['name']),
          arguments: '',
        }
        this.blocks.set(index, block)
        switch (block.typeName) {
          case 'tool_use':
          case 'server_tool_use': {
            const event = this.baseEvent(EVENT_FUNCTION_CALL_ADDED, raw)
            event.content_index = index
            event.tool_call_index = index
            event.tool_call_id = block.id
            event.tool_name = block.name
            events.push(event)
            break
          }
          case 'thinking': {
            const part: MaheshvaraContentPart = {
              type: CONTENT_REASONING, thought: true,
              signature_provider: SIGNATURE_PROVIDER_ANTHROPIC, raw: blockValue,
            }
            const event = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
            event.content_index = index
            event.content_part = part
            events.push(event)
            break
          }
          case 'redacted_thinking': {
            const envelope = decodeMaheshvaraReasoningEnvelope(stringValue(blockValue['data']))
            if (envelope) {
              const part: MaheshvaraContentPart = {
                type: CONTENT_REASONING, thought: true,
                reasoning_text: envelope.text, text: envelope.text,
                signature_provider: SIGNATURE_PROVIDER_MAHESHVARA,
                encrypted_content: envelope.encrypted_content,
                reasoning_summary: envelope.summary, raw: blockValue,
              }
              const event = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
              event.content_index = index
              event.content_part = part
              events.push(event)
            }
            break
          }
          case 'text': {
            const part: MaheshvaraContentPart = { type: CONTENT_TEXT, raw: blockValue }
            const event = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
            event.content_index = index
            event.content_part = part
            events.push(event)
            break
          }
          default: {
            const part: MaheshvaraContentPart = { type: block.typeName, raw: blockValue }
            const event = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
            event.content_index = index
            event.content_part = part
            events.push(event)
          }
        }
        break
      }
      case 'content_block_delta': {
        const index = intValue(raw['index'])
        const block = this.blocks.get(index)
        const delta = asRecord(raw['delta']) ?? {}
        switch (stringValue(delta['type'])) {
          case 'text_delta': {
            const text = stringValue(delta['text'])
            if (text !== '') {
              const event = this.baseEvent(EVENT_TEXT_DELTA, raw)
              event.content_index = index
              event.delta = text
              events.push(event)
            }
            break
          }
          case 'thinking_delta': {
            const text = stringValue(delta['thinking'])
            if (text !== '') {
              const event = this.baseEvent(EVENT_REASONING_DELTA, raw)
              event.content_index = index
              event.reasoning_delta = text
              events.push(event)
            }
            break
          }
          case 'signature_delta': {
            const signature = stringValue(delta['signature'])
            if (signature !== '') {
              const event = this.baseEvent(EVENT_REASONING_SIGNATURE_DELTA, raw)
              event.content_index = index
              event.reasoning_signature_delta = signature
              event.reasoning_signature_provider = SIGNATURE_PROVIDER_ANTHROPIC
              events.push(event)
            }
            break
          }
          case 'input_json_delta': {
            const argumentsText = stringValue(delta['partial_json'])
            if (block) block.arguments += argumentsText
            if (argumentsText !== '') {
              const event = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DELTA, raw)
              event.content_index = index
              event.tool_call_index = index
              if (block) {
                event.tool_call_id = block.id
                event.tool_name = block.name
              }
              event.tool_arguments_delta = argumentsText
              events.push(event)
            }
            break
          }
          case 'citations_delta': {
            const citation = asRecord(delta['citation'])
            if (citation) {
              // 引用标注不生成独立 part（空文本 part 在部分渲染器会被当作
              // 畸形块回放）；挂到事件 annotations 载体，由 Claude 渲染器
              // 在对应文本块收尾前发合法的 citations_delta。
              const event = this.baseEvent(EVENT_ANNOTATION_DELTA, raw)
              event.content_index = index
              event.annotations = [citation]
              events.push(event)
            }
            break
          }
        }
        break
      }
      case 'content_block_stop': {
        const index = intValue(raw['index'])
        const block = this.blocks.get(index)
        if (block && (block.typeName === 'tool_use' || block.typeName === 'server_tool_use')) {
          const event = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DONE, raw)
          event.content_index = index
          event.tool_call_index = index
          event.tool_call_id = block.id
          event.tool_name = block.name
          event.tool_arguments_done = firstNonEmptyString(block.arguments, '{}')
          events.push(event)
        }
        const doneEvent = this.baseEvent(EVENT_OUTPUT_ITEM_DONE, raw)
        doneEvent.content_index = index
        events.push(doneEvent)
        break
      }
      case 'message_delta': {
        const usage = usageFromRawMap(asRecord(raw['usage']))
        if (usage) {
          // 合并快照语义：delta 只带累积 output（input 缺省 0），回填 message_start
          // 记录的 input 侧，使每条 usage 事件都是完整可独立消费的快照。
          const merged = { ...usage }
          if (this.lastUsage) {
            if (merged.input_tokens === 0) merged.input_tokens = this.lastUsage.input_tokens
            if (!merged.cached_input_tokens) merged.cached_input_tokens = this.lastUsage.cached_input_tokens
            if (merged.total_tokens === merged.output_tokens) {
              merged.total_tokens = merged.input_tokens + merged.output_tokens
            }
          }
          this.lastUsage = { ...merged }
          const usageEvent = this.baseEvent(EVENT_USAGE_DELTA, raw)
          usageEvent.usage = merged
          events.push(usageEvent)
        }
        const delta = asRecord(raw['delta']) ?? {}
        const finishReason = stringValue(delta['stop_reason'])
        if (finishReason !== '') {
          this.terminal = true
          const event = this.baseEvent(EVENT_RESPONSE_COMPLETED, raw)
          event.finish_reason = finishReason
          event.stop_sequence = stringValue(delta['stop_sequence'])
          events.push(event)
        }
        break
      }
      case 'message_stop': {
        if (!this.terminal) {
          this.terminal = true
          events.push(this.baseEvent(EVENT_RESPONSE_COMPLETED, raw))
        }
        break
      }
      case 'error': {
        this.terminal = true
        const errorValue = asRecord(raw['error']) ?? {}
        const errType = stringValue(errorValue['type'])
        const event = this.baseEvent(EVENT_RESPONSE_FAILED, raw)
        event.error = {
          message: firstNonEmptyString(stringValue(errorValue['message']), 'Anthropic stream error'),
          type: errType || undefined,
          class: classFromAnthropicType(errType),
          raw: errorValue,
        }
        events.push(event)
        break
      }
      case 'ping':
        return []
      default: {
        if (typeName !== '') {
          events.push(this.baseEvent(typeName, raw))
        }
      }
    }
    return events
  }
}
