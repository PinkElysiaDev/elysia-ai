/**
 * OpenAI Chat Completions SSE 流 → maheshvara 流事件。
 * 逐行为对齐 maheshvara_stream_decoder.go 的 decodeOpenAIChat /
 * decodeOpenAIToolCalls / openAIContentEvents / openAIReasoningSignatureProvider，
 * 以及 maheshvara_stream.go 的 maheshvaraUsageFromRawMap（此处 usageFromRawMap）。
 * 有状态：工具调用参数与内容块会跨多个上游事件分片到达。
 */

import type { MaheshvaraContentPart, MaheshvaraStreamEvent, MaheshvaraUsage, SSEEvent } from '@elysia-ai/maheshvara'
import {
  CONTENT_AUDIO,
  CONTENT_REASONING,
  CONTENT_REFUSAL,
  CONTENT_TEXT,
  ERROR_CLASS_UPSTREAM,
  EVENT_CONTENT_PART_ADDED,
  EVENT_FUNCTION_CALL_ADDED,
  EVENT_FUNCTION_CALL_ARGUMENTS_DELTA,
  EVENT_FUNCTION_CALL_ARGUMENTS_DONE,
  EVENT_REASONING_DELTA,
  EVENT_REASONING_SIGNATURE_DELTA,
  EVENT_REFUSAL_DELTA,
  EVENT_RESPONSE_COMPLETED,
  EVENT_RESPONSE_FAILED,
  EVENT_RESPONSE_IN_PROGRESS,
  EVENT_TEXT_DELTA,
  EVENT_USAGE_DELTA,
  SIGNATURE_PROVIDER_GEMINI,
} from '@elysia-ai/maheshvara'
import {
  asArray,
  asRecord,
  firstNonEmptyString,
  interfaceToContentParts,
  intValue,
  stringValue,
  usageFromRawMap,
} from '@elysia-ai/maheshvara'

interface ToolCallState {
  id: string
  name: string
  arguments: string
  added: boolean
}

function openAIGoogleThoughtSignature(tool: Record<string, unknown> | undefined): string {
  if (!tool) return ''
  const extra = asRecord(tool['extra_content'])
  const google = extra ? asRecord(extra['google']) : undefined
  return firstNonEmptyString(
    google ? stringValue(google['thought_signature']) : '',
    google ? stringValue(google['thoughtSignature']) : '',
    stringValue(tool['thought_signature']),
    stringValue(tool['thoughtSignature']),
  )
}

function openAIReasoningSignatureProvider(detail: Record<string, unknown>): string {
  const provider = stringValue(detail['provider']).trim().toLowerCase()
  if (provider !== '') return provider
  const typeName = firstNonEmptyString(stringValue(detail['type']), stringValue(detail['format'])).toLowerCase()
  if (typeName.includes('google') || typeName.includes('gemini')) return SIGNATURE_PROVIDER_GEMINI
  if (typeName.includes('anthropic') || typeName.includes('claude')) return 'anthropic'
  if (typeName.includes('openai')) return 'openai'
  return ''
}

function eventHasOutput(event: MaheshvaraStreamEvent): boolean {
  return (event.delta ?? '') !== '' || (event.reasoning_delta ?? '') !== '' || (event.refusal_delta ?? '') !== ''
    || (event.tool_name ?? '') !== '' || (event.tool_arguments_delta ?? '') !== '' || (event.tool_arguments_done ?? '') !== ''
    || event.content_part !== undefined || event.output_item !== undefined
    || (event.response?.output?.length ?? 0) > 0
}

export class ChatCompletionsStreamDecoder {
  private responseID = ''
  private model = ''
  private terminal = false
  private sawWireEvent = false
  private sawOutput = false
  private sawFinishReason = false
  // P2-14：键含 choiceIndex——n>1 时不同 choice 的同名 tool index 参数
  // 会在跨 choice 共享的 Map 里互相拼接（toolOrder 同理）。
  private readonly tools = new Map<string, ToolCallState>()
  private readonly toolOrder: string[] = []
  private readonly finishedChoices = new Set<number>()
  private readonly seenChoices = new Set<number>()
  private readonly choiceReasoned = new Set<number>()
  /** 按 (choice, contentIndex) 分桶累计快照文本：终态 message 携带完整快照时只补缺失后缀。 */
  private readonly partText = new Map<string, string>()

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
      // 已见过 choice 却从未收到任何 finish_reason：[DONE] 不是终态替身，
      // 这样的流是残缺的（对齐 PC7/DC7b：不允许把没写完的答卷当完整交付）。
      if (this.seenChoices.size > 0 && !this.allChoicesFinished()) {
        const failed = this.baseEvent(EVENT_RESPONSE_FAILED, {})
        failed.error = { message: 'upstream stream ended without a finish_reason', type: 'upstream_stream_error' }
        return [failed]
      }
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

    const events = this.decodeChat(raw)
    for (const item of events) {
      if (!item.response_id) item.response_id = this.responseID
      if (!item.model) item.model = this.model
      if (eventHasOutput(item)) this.sawOutput = true
    }
    return events
  }

  private decodeChat(raw: Record<string, unknown>): MaheshvaraStreamEvent[] {
    this.responseID = firstNonEmptyString(stringValue(raw['id']), this.responseID)
    this.model = firstNonEmptyString(stringValue(raw['model']), this.model)
    const createdAt = intValue(raw['created'])
    const events: MaheshvaraStreamEvent[] = []
    const usage = usageFromRawMap(asRecord(raw['usage']))
    if (usage) {
      const usageEvent = this.baseEvent(EVENT_USAGE_DELTA, raw)
      usageEvent.usage = usage
      usageEvent.created_at = createdAt
      events.push(usageEvent)
    }

    const terminalEvents: MaheshvaraStreamEvent[] = []
    for (const choiceValue of asArray(raw['choices']) ?? []) {
      const choice = asRecord(choiceValue)
      if (!choice) continue
      const choiceIndex = intValue(choice['index'])
      this.seenChoices.add(choiceIndex)
      let delta = asRecord(choice['delta'])
      let snapshot = false
      if (!delta) {
        // 终态 chunk 用完整 message 回传时是快照而非增量：已流式输出过的
        // 内容只能补缺失后缀，不能整段重发（PC7f）。
        delta = asRecord(choice['message'])
        snapshot = delta !== undefined
      }
      delta ??= {}
      const role = stringValue(delta['role'])
      if (role !== '') {
        const roleEvent = this.baseEvent(EVENT_RESPONSE_IN_PROGRESS, raw)
        roleEvent.role = role
        roleEvent.choice_index = choiceIndex
        roleEvent.created_at = createdAt
        events.push(roleEvent)
      }
      events.push(...this.contentEvents(delta['content'], choiceIndex, raw, snapshot))

      const reasoning = firstNonEmptyString(
        stringValue(delta['reasoning_content']),
        stringValue(delta['reasoning']),
        stringValue(delta['thinking']),
      )
      if (reasoning !== '' && !(snapshot && this.choiceReasoned.has(choiceIndex))) {
        this.choiceReasoned.add(choiceIndex)
        const reasoningEvent = this.baseEvent(EVENT_REASONING_DELTA, raw)
        reasoningEvent.choice_index = choiceIndex
        reasoningEvent.reasoning_delta = reasoning
        events.push(reasoningEvent)
      }
      const refusal = stringValue(delta['refusal'])
      if (refusal !== '') {
        const refusalEvent = this.baseEvent(EVENT_REFUSAL_DELTA, raw)
        refusalEvent.choice_index = choiceIndex
        refusalEvent.refusal_delta = refusal
        events.push(refusalEvent)
      }
      const details = asArray(delta['reasoning_details'])
      if (details) {
        for (const detailValue of details) {
          const detail = asRecord(detailValue)
          if (!detail) continue
          const text = firstNonEmptyString(stringValue(detail['text']), stringValue(detail['content']))
          if (text !== '') {
            const textEvent = this.baseEvent(EVENT_REASONING_DELTA, raw)
            textEvent.choice_index = choiceIndex
            textEvent.reasoning_delta = text
            events.push(textEvent)
          }
          const signature = firstNonEmptyString(stringValue(detail['signature']), stringValue(detail['data']))
          if (signature !== '') {
            const signatureEvent = this.baseEvent(EVENT_REASONING_SIGNATURE_DELTA, raw)
            signatureEvent.choice_index = choiceIndex
            signatureEvent.reasoning_signature_delta = signature
            signatureEvent.reasoning_signature_provider = openAIReasoningSignatureProvider(detail)
            events.push(signatureEvent)
          }
        }
      }
      const signature = stringValue(delta['reasoning_signature'])
      if (signature !== '') {
        const signatureEvent = this.baseEvent(EVENT_REASONING_SIGNATURE_DELTA, raw)
        signatureEvent.choice_index = choiceIndex
        signatureEvent.reasoning_signature_delta = signature
        signatureEvent.reasoning_signature_provider = stringValue(delta['reasoning_signature_provider'])
        events.push(signatureEvent)
      }
      const audio = asRecord(delta['audio'])
      if (audio) {
        const part: MaheshvaraContentPart = {
          type: CONTENT_AUDIO,
          audio_base64: firstNonEmptyString(stringValue(audio['data']), stringValue(audio['audio_data'])),
          audio_url: firstNonEmptyString(stringValue(audio['url']), stringValue(audio['audio_url'])),
          text: stringValue(audio['transcript']),
          media_type: firstNonEmptyString(stringValue(audio['format']), stringValue(audio['mime_type'])),
          raw: audio,
        }
        const audioEvent = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
        audioEvent.choice_index = choiceIndex
        audioEvent.content_part = part
        events.push(audioEvent)
      }
      const toolCalls = asArray(delta['tool_calls'])
      if (toolCalls) {
        events.push(...this.decodeToolCalls(toolCalls, choiceIndex, raw, snapshot))
      }

      const finishReason = stringValue(choice['finish_reason'])
      if (finishReason !== '') {
        this.sawFinishReason = true
        this.finishedChoices.add(choiceIndex)
        // finish_reason:"error" 是终态失败，不得伪装成正常 stop（DC5b）。
        if (finishReason.toLowerCase() === 'error') {
          const failed = this.baseEvent(EVENT_RESPONSE_FAILED, raw)
          const rawError = asRecord(raw['error'])
          const message = firstNonEmptyString(
            rawError ? stringValue(rawError['message']) : '',
            stringValue(delta['content']),
          ) || 'upstream reported finish_reason=error'
          failed.error = { message, type: 'upstream_stream_error', class: ERROR_CLASS_UPSTREAM }
          terminalEvents.push(failed)
          continue
        }
        for (const compositeKey of this.toolOrder) {
          const [keyChoice, keyTool] = splitToolKey(compositeKey)
          if (keyChoice !== choiceIndex) continue // 只 flush 本 choice 的工具
          const state = this.tools.get(compositeKey)
          if (!state || state.arguments.length === 0) continue
          const doneEvent = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DONE, raw)
          doneEvent.choice_index = choiceIndex
          doneEvent.tool_call_index = keyTool
          doneEvent.tool_call_id = state.id
          doneEvent.tool_name = state.name
          doneEvent.tool_arguments_done = state.arguments
          terminalEvents.push(doneEvent)
        }
        const completedEvent = this.baseEvent(EVENT_RESPONSE_COMPLETED, raw)
        completedEvent.choice_index = choiceIndex
        completedEvent.finish_reason = finishReason
        completedEvent.created_at = createdAt
        terminalEvents.push(completedEvent)
      }
    }
    if (this.seenChoices.size > 0 && this.allChoicesFinished()) {
      this.terminal = true
    }
    return [...events, ...terminalEvents]
  }

  private allChoicesFinished(): boolean {
    for (const index of this.seenChoices) {
      if (!this.finishedChoices.has(index)) return false
    }
    return true
  }

  private decodeToolCalls(
    toolCalls: unknown[],
    choiceIndex: number,
    raw: Record<string, unknown>,
    snapshot: boolean,
  ): MaheshvaraStreamEvent[] {
    const events: MaheshvaraStreamEvent[] = []
    for (const toolValue of toolCalls) {
      const tool = asRecord(toolValue)
      if (!tool) continue
      const toolIndex = intValue(tool['index'])
      const compositeKey = `${choiceIndex}:${toolIndex}`
      let state = this.tools.get(compositeKey)
      if (!state) {
        state = { id: '', name: '', arguments: '', added: false }
        this.tools.set(compositeKey, state)
        this.toolOrder.push(compositeKey)
      }
      const fn = asRecord(tool['function']) ?? {}
      const signature = openAIGoogleThoughtSignature(tool)
      if (signature !== '') {
        const signatureEvent = this.baseEvent(EVENT_REASONING_SIGNATURE_DELTA, raw)
        signatureEvent.choice_index = choiceIndex
        signatureEvent.tool_call_index = toolIndex
        signatureEvent.reasoning_signature_delta = signature
        signatureEvent.reasoning_signature_provider = SIGNATURE_PROVIDER_GEMINI
        events.push(signatureEvent)
      }
      state.id = firstNonEmptyString(stringValue(tool['id']), state.id)
      state.name = firstNonEmptyString(stringValue(fn['name']), state.name)
      if (!state.added && (state.id !== '' || state.name !== '')) {
        state.added = true
        const addedEvent = this.baseEvent(EVENT_FUNCTION_CALL_ADDED, raw)
        addedEvent.choice_index = choiceIndex
        addedEvent.tool_call_index = toolIndex
        addedEvent.tool_call_id = state.id
        addedEvent.tool_name = state.name
        events.push(addedEvent)
      }
      const argumentsText = stringValue(fn['arguments'])
      if (argumentsText !== '') {
        if (snapshot) {
          // 快照是完整参数值：与已累计内容一致时不重发，否则作为完整值
          // 走 done 事件（渲染层对 done 做前缀差分，只补后缀）。
          if (state.arguments === argumentsText) continue
          this.tools.set(compositeKey, { id: state.id, name: state.name, arguments: argumentsText, added: true })
          const doneEvent = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DONE, raw)
          doneEvent.choice_index = choiceIndex
          doneEvent.tool_call_index = toolIndex
          doneEvent.tool_call_id = state.id
          doneEvent.tool_name = state.name
          doneEvent.tool_arguments_done = argumentsText
          events.push(doneEvent)
          continue
        }
        state.arguments += argumentsText
        const deltaEvent = this.baseEvent(EVENT_FUNCTION_CALL_ARGUMENTS_DELTA, raw)
        deltaEvent.choice_index = choiceIndex
        deltaEvent.tool_call_index = toolIndex
        deltaEvent.tool_call_id = state.id
        deltaEvent.tool_name = state.name
        deltaEvent.tool_arguments_delta = argumentsText
        events.push(deltaEvent)
      }
    }
    return events
  }

  private contentEvents(
    value: unknown,
    choiceIndex: number,
    raw: Record<string, unknown>,
    snapshot: boolean,
  ): MaheshvaraStreamEvent[] {
    if (typeof value === 'string') {
      if (value === '') return []
      if (snapshot) return this.snapshotTextSuffix(value, choiceIndex, 0, raw)
      this.accumulatePartText(choiceIndex, 0, value)
      const textEvent = this.baseEvent(EVENT_TEXT_DELTA, raw)
      textEvent.choice_index = choiceIndex
      textEvent.delta = value
      return [textEvent]
    }
    const parts = interfaceToContentParts(value)
    const events: MaheshvaraStreamEvent[] = []
    parts.forEach((part, index) => {
      const event = this.baseEvent(EVENT_CONTENT_PART_ADDED, raw)
      event.choice_index = choiceIndex
      event.content_index = index
      switch (part.type) {
        case CONTENT_TEXT:
          event.type = EVENT_TEXT_DELTA
          event.delta = part.text ?? ''
          break
        case CONTENT_REASONING:
          event.type = EVENT_REASONING_DELTA
          event.reasoning_delta = firstNonEmptyString(part.reasoning_text ?? '', part.text ?? '')
          break
        case CONTENT_REFUSAL:
          event.type = EVENT_REFUSAL_DELTA
          event.refusal_delta = part.text ?? ''
          break
        default:
          event.content_part = part
      }
      if (event.type === EVENT_TEXT_DELTA && snapshot) {
        events.push(...this.snapshotTextSuffix(event.delta ?? '', choiceIndex, index, raw))
        return
      }
      if (eventHasOutput(event)) {
        if (event.type === EVENT_TEXT_DELTA) {
          this.accumulatePartText(choiceIndex, index, event.delta ?? '')
        }
        if (event.type === EVENT_REASONING_DELTA) {
          this.choiceReasoned.add(choiceIndex)
        }
        events.push(event)
      }
    })
    return events
  }

  private accumulatePartText(choiceIndex: number, contentIndex: number, text: string): void {
    const key = `${choiceIndex}:${contentIndex}`
    this.partText.set(key, (this.partText.get(key) ?? '') + text)
  }

  /**
   * 应用终态快照的后缀语义（PC7f）：完整文本与已流式输出的前缀一致时只补
   * 缺失后缀；完全相同或分歧（非前缀）时不再重发，避免下游收到重复/冲突
   * 内容。
   */
  private snapshotTextSuffix(
    text: string,
    choiceIndex: number,
    contentIndex: number,
    raw: Record<string, unknown>,
  ): MaheshvaraStreamEvent[] {
    const key = `${choiceIndex}:${contentIndex}`
    const streamed = this.partText.get(key) ?? ''
    if (text === streamed || streamed === '') {
      if (streamed === '') {
        this.partText.set(key, text)
        const event = this.baseEvent(EVENT_TEXT_DELTA, raw)
        event.choice_index = choiceIndex
        event.delta = text
        return [event]
      }
      return []
    }
    if (text.startsWith(streamed)) {
      const suffix = text.slice(streamed.length)
      this.partText.set(key, text)
      const event = this.baseEvent(EVENT_TEXT_DELTA, raw)
      event.choice_index = choiceIndex
      event.delta = suffix
      return [event]
    }
    return []
  }
}

/** "choiceIndex:toolIndex" 复合键拆分（P2-14）。 */
function splitToolKey(key: string): [number, number] {
  const separator = key.indexOf(':')
  return [Number(key.slice(0, separator)), Number(key.slice(separator + 1))]
}
