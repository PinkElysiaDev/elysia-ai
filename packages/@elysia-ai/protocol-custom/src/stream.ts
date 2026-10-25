/**
 * 自定义协议流解码器：帧匹配（事件名/谓词）→ 响应映射 → delta/cumulative
 * 差分 → Maheshvara 流事件。与 Elysia-Api（Go）
 * `backend/relay/custom_stream_mapping.go` 逐行为对齐。
 * 传输层排水迭代（ForEachBatch / 终态后 2s 排水窗）归调用方（gateway）。
 */

import type {
  MaheshvaraOutputItem,
  MaheshvaraResponse,
  MaheshvaraStreamEvent,
  SSEEvent,
} from '@elysia-ai/maheshvara'
import {
  EVENT_CONTENT_PART_ADDED,
  EVENT_FUNCTION_CALL_ADDED,
  EVENT_FUNCTION_CALL_ARGUMENTS_DELTA,
  EVENT_REASONING_DELTA,
  EVENT_REFUSAL_DELTA,
  EVENT_RESPONSE_COMPLETED,
  EVENT_RESPONSE_FAILED,
  EVENT_TEXT_DELTA,
  EVENT_USAGE_DELTA,
} from '@elysia-ai/maheshvara'
import type {
  CustomProtocolConfig,
  CustomProtocolMatch,
  CustomProtocolStreamFrame,
  CustomProtocolStreamTool,
} from './types.js'
import { customMatchEval, customJSONValuesEqual } from './match.js'
import { customLookupPath, customValueString, customNumberValue } from './paths.js'
import { customProtocolResponseFromRoot, resolveCustomMapping, type CustomResolvedMapping } from './response.js'
import { validateCustomProtocol } from './validate.js'

/** 身份帧声明的工具身份，供仅携带 index 的参数帧关联。 */
interface CustomProtocolStreamToolIdentity {
  id: string
  name: string
}

export interface CustomStreamDecodeResult {
  events: MaheshvaraStreamEvent[]
  /** 仅在该帧命中终止值（doneValues/done）时为 true（数据此后不会再有）。 */
  done: boolean
}

function firstNonEmptyString(...values: string[]): string {
  for (const value of values) {
    if (value !== '') return value
  }
  return ''
}

function hasStreamEventOutput(event: MaheshvaraStreamEvent): boolean {
  return (event.delta ?? '') !== ''
    || (event.reasoning_delta ?? '') !== ''
    || (event.refusal_delta ?? '') !== ''
    || (event.tool_name ?? '') !== ''
    || (event.tool_arguments_delta ?? '') !== ''
    || (event.tool_arguments_done ?? '') !== ''
    || event.content_part !== undefined
    || event.output_item !== undefined
    || (event.response?.output?.length ?? 0) > 0
}

export class CustomProtocolStreamDecoder {
  private readonly config: CustomProtocolConfig
  private readonly aliases: CustomProtocolConfig['aliases']
  private resolved: CustomResolvedMapping
  private readonly frameResolved: CustomResolvedMapping[]
  private mode = 'delta'
  private modeText = 'delta'
  private modeReasoning = 'delta'
  private modeArgs = 'delta'
  private readonly doneValues = new Set<string>(['[DONE]'])
  private readonly doneJSON: unknown[] = []
  private readonly events = new Set<string>()
  private eventKeys: string[] = ['type', 'event']
  private finishWhen: CustomProtocolMatch | undefined
  private statusWhen: CustomProtocolMatch | undefined
  private readonly frames: CustomProtocolStreamFrame[] = []
  private readonly previousText = new Map<string, string>()
  private readonly previousReasoning = new Map<string, string>()
  private readonly previousArguments = new Map<string, string>()
  private readonly toolAdded = new Map<string, boolean>()
  private readonly toolSlot = new Map<string, number>()
  private nextToolSlot = 0
  private readonly frameTools = new Map<number, CustomProtocolStreamToolIdentity>()
  private terminal = false
  private sawOutput = false
  private sawFinish = false

  /** 为已校验配置构造流解码器（注册表热路径）。 */
  constructor(config: CustomProtocolConfig) {
    this.config = config
    this.aliases = config.aliases
    const stream = config.response?.stream
    if (stream) {
      const mode = (stream.mode ?? '').trim().toLowerCase()
      if (mode !== '') this.mode = mode
      this.modeText = this.mode
      this.modeReasoning = this.mode
      this.modeArgs = this.mode
      if (stream.modes) {
        const text = (stream.modes.text ?? '').trim().toLowerCase()
        const reasoning = (stream.modes.reasoning ?? '').trim().toLowerCase()
        const arguments_ = (stream.modes.arguments ?? '').trim().toLowerCase()
        if (text !== '') this.modeText = text
        if (reasoning !== '') this.modeReasoning = reasoning
        if (arguments_ !== '') this.modeArgs = arguments_
      }
      if (stream.doneValuesReplace) this.doneValues.clear()
      for (const value of stream.doneValues ?? []) {
        const trimmed = value.trim()
        if (trimmed !== '') this.doneValues.add(trimmed)
      }
      for (const done of stream.done ?? []) {
        const raw = (done.raw ?? '').trim()
        if (raw !== '') this.doneValues.add(raw)
        if (done.json !== undefined) this.doneJSON.push(done.json)
      }
      for (const eventName of stream.events ?? []) {
        const trimmed = eventName.trim()
        if (trimmed !== '') this.events.add(trimmed)
      }
      if ((stream.eventKeys?.length ?? 0) > 0) this.eventKeys = stream.eventKeys!
      this.finishWhen = stream.finishWhen
      this.statusWhen = stream.statusWhen
      for (const frame of stream.frames ?? []) {
        this.frames.push({ ...frame, event: (frame.event ?? '').trim() })
      }
    }
    // 运行时映射在构造时对默认路径与每个帧各预编译一份，事件循环零编译。
    this.resolved = resolveCustomMapping(config, true)
    this.frameResolved = this.frames.map((frame) => {
      if (frame.response || (frame.payloadPath ?? '').trim() !== '') {
        return resolveCustomMapping(customProtocolFrameConfig(config, frame), true)
      }
      return this.resolved
    })
  }

  terminalReceived(): boolean {
    return this.terminal
  }

  sawStreamOutput(): boolean {
    return this.sawOutput
  }

  /** 流中是否出现过非空 finish reason（空补全与「[DONE] 兜底空流」的区分）。 */
  sawFinishReason(): boolean {
    return this.sawFinish
  }

  /**
   * 解析一帧上游事件。done 仅在该帧命中终止值时为 true；终止判定
   * （finish reason / status）只置终态，不提前结束——调用方继续排水以接收
   * usage 尾帧等滞后事件。
   */
  decode(wireEvent: SSEEvent): CustomStreamDecodeResult {
    const data = wireEvent.data.trim()
    if (data === '') return { events: [], done: false }
    // 帧载荷只解析一次：帧匹配、响应映射与终止判定共用同一 root。
    let root: unknown
    let rootOK = true
    try {
      root = JSON.parse(data)
    } catch {
      root = undefined
      rootOK = false
    }
    if (this.doneValues.has(data)) {
      this.terminal = true
      return { events: [{ type: EVENT_RESPONSE_COMPLETED }], done: true }
    }
    if (this.doneJSON.length > 0 && rootOK && this.doneJSON.some((expected) => customJSONValuesEqual(root, expected))) {
      this.terminal = true
      return { events: [{ type: EVENT_RESPONSE_COMPLETED }], done: true }
    }
    let resolved = this.resolved
    let terminalFrame = false
    let frameTool: CustomProtocolStreamTool | undefined
    if (this.frames.length > 0) {
      const eventName = this.effectiveEventName(wireEvent.event, root, rootOK)
      const frameIndex = this.matchFrameIndex(eventName, root, rootOK)
      if (frameIndex < 0) {
        // 异构流中未声明的帧型不属于本协议语义，跳过；需要兜底映射时用
        // stream.response 声明默认映射。
        return { events: [], done: false }
      }
      resolved = this.frameResolved[frameIndex]
      terminalFrame = this.frames[frameIndex].terminal === true
      frameTool = this.frames[frameIndex].tool
    } else if (this.events.size > 0) {
      const eventName = this.effectiveEventName(wireEvent.event, root, rootOK)
      if (!this.events.has(eventName)) {
        return { events: [], done: false }
      }
    }
    if (!rootOK) {
      throw new Error('failed to parse custom protocol stream event: not valid JSON')
    }
    const response = customProtocolResponseFromRoot(root, resolved, this.aliases, this.config.id, true)
    if (frameTool) {
      response.output = [...(response.output ?? []), ...this.frameToolItems(frameTool, root)]
    }
    let events = this.buildContentEvents(response, this.frameArgsMode(frameTool))
    // 终止判定：finishWhen/statusWhen 配置时按 Match 语义（对帧原始载荷求值）；
    // 缺省沿用 legacy——finishReasonPath 字符串化非空、status == "completed"。
    let finishHit = (response.stop_reason ?? '') !== ''
    if (this.finishWhen) finishHit = customMatchEval(root, this.finishWhen)
    let statusHit = response.status === 'completed'
    if (this.statusWhen) statusHit = customMatchEval(root, this.statusWhen)
    if (finishHit || statusHit) {
      if (finishHit) this.sawFinish = true
      events = [...events, {
        type: EVENT_RESPONSE_COMPLETED,
        response_id: response.id,
        model: response.model,
        finish_reason: response.stop_reason,
        response,
      }]
    }
    if (terminalFrame) {
      this.terminal = true
      if (!finishHit && !statusHit) {
        // 帧型终止：映射本身未产生终态事件时补一个空完成事件，保证渲染侧仍能拿到 finish。
        events = [...events, { type: EVENT_RESPONSE_COMPLETED, response_id: response.id, model: response.model }]
      }
    }
    for (const event of events) {
      if (hasStreamEventOutput(event)) this.sawOutput = true
      if (event.type === EVENT_RESPONSE_COMPLETED || event.type === EVENT_RESPONSE_FAILED) {
        this.terminal = true
      }
    }
    return { events, done: false }
  }

  /** 选中首个匹配帧的下标（-1 表示未命中）：事件名与谓词都给出时须同时成立。 */
  private matchFrameIndex(eventName: string, root: unknown, rootOK: boolean): number {
    for (let index = 0; index < this.frames.length; index++) {
      const frame = this.frames[index]
      if ((frame.event ?? '') !== '') {
        if (eventName === '' || frame.event !== eventName) continue
      }
      if (frame.match) {
        if (!rootOK || !customMatchEval(root, frame.match)) continue
      }
      return index
    }
    return -1
  }

  /**
   * 取帧的事件名：优先 SSE event 字段，缺省时按 eventKeys（默认 type/event）
   * 回落已解析载荷内的字段（Responses 型协议把类型写在数据里）。
   */
  private effectiveEventName(wireEventName: string, root: unknown, rootOK: boolean): string {
    const trimmed = (wireEventName ?? '').trim()
    if (trimmed !== '' || !rootOK) return trimmed
    if (typeof root !== 'object' || root === null || Array.isArray(root)) return ''
    const object = root as Record<string, unknown>
    for (const key of this.eventKeys) {
      const name = typeof object[key] === 'string' ? object[key] as string : ''
      if (name !== '') return name
    }
    return ''
  }

  /**
   * 从帧 JSON 组装工具调用增量（单帧可多工具）：身份帧（id/name 可得）注册
   * index→身份；参数帧经 index 关联或直接携带 id。仅身份无参数时 Arguments
   * 留空。tool.path 指向工具数组时按元素遍历，各路径相对元素。
   */
  private frameToolItems(tool: CustomProtocolStreamTool, root: unknown): MaheshvaraOutputItem[] {
    if ((tool.path ?? '').trim() === '') {
      const item = this.buildFrameToolItem(tool, root)
      return item ? [item] : []
    }
    const { value: arrayValue, found } = customLookupPath(root, tool.path!)
    const elements = found
      ? Array.isArray(arrayValue) ? arrayValue : arrayValue !== undefined && arrayValue !== null ? [arrayValue] : []
      : []
    const items: MaheshvaraOutputItem[] = []
    for (const element of elements) {
      const item = this.buildFrameToolItem(tool, element)
      if (item) items.push(item)
    }
    return items
  }

  private buildFrameToolItem(tool: CustomProtocolStreamTool, element: unknown): MaheshvaraOutputItem | undefined {
    let id = customValueString(customLookupPath(element, tool.idPath ?? '').value)
    let name = customValueString(customLookupPath(element, tool.namePath ?? '').value)
    let index = 0
    let hasIndex = false
    if ((tool.indexPath ?? '').trim() !== '') {
      const number = customNumberValue(customLookupPath(element, tool.indexPath!).value)
      if (number !== undefined) {
        index = number
        hasIndex = true
      }
    }
    if (hasIndex) {
      const identity = this.frameTools.get(index)
      if (identity) {
        if (id === '') id = identity.id
        if (name === '') name = identity.name
      } else if (id !== '' || name !== '') {
        this.frameTools.set(index, { id, name })
      }
    }
    if (id === '' && name === '') return undefined // 无身份可关联（身份帧未到）
    const item: MaheshvaraOutputItem = {
      type: 'function_call',
      status: 'completed',
      call_id: id,
      name,
    }
    if ((tool.argumentsPath ?? '').trim() !== '') {
      const argumentsValue = customLookupPath(element, tool.argumentsPath!).value
      if (argumentsValue !== undefined && argumentsValue !== null) {
        if (typeof argumentsValue === 'string') {
          // 参数片段按定义可能是不完整 JSON（input_json_delta 分片），原样透传
          // 供拼接，不做「无效 JSON 加引号」保护。
          item.arguments = argumentsValue
        } else {
          item.arguments = JSON.stringify(argumentsValue)
        }
      }
    }
    return item
  }

  /** 计算本帧工具参数的差分模式：帧级 argumentsMode 覆盖族级。 */
  private frameArgsMode(tool: CustomProtocolStreamTool | undefined): string {
    if (tool) {
      const mode = (tool.argumentsMode ?? '').trim().toLowerCase()
      if (mode === 'delta' || mode === 'cumulative') return mode
    }
    return this.modeArgs
  }

  /** 产生一帧映射出的内容/工具/用量事件；终止事件由 decode 统一判定。 */
  private buildContentEvents(response: MaheshvaraResponse, argsMode: string): MaheshvaraStreamEvent[] {
    let events: MaheshvaraStreamEvent[] = []
    if (response.error) {
      return [{
        type: EVENT_RESPONSE_FAILED,
        response_id: response.id,
        model: response.model,
        error: response.error,
      }]
    }
    ;(response.output ?? []).forEach((item, outputIndex) => {
      switch (item.type) {
        case 'function_call': {
          const key = firstNonEmptyString(item.call_id ?? '', item.name ?? '', `tool_${outputIndex}`)
          // 下游按 tool_call_index 组装工具状态；本帧 Output 数组下标是临时位置，
          // 跨帧的多个工具会全部撞在 0——改用流级稳定槽位（身份键首次出现时分配）。
          let slot = this.toolSlot.get(key)
          if (slot === undefined) {
            slot = this.nextToolSlot
            this.nextToolSlot++
            this.toolSlot.set(key, slot)
          }
          if (!this.toolAdded.get(key)) {
            this.toolAdded.set(key, true)
            events.push({
              type: EVENT_FUNCTION_CALL_ADDED,
              response_id: response.id,
              model: response.model,
              output_index: slot,
              tool_call_index: slot,
              tool_call_id: item.call_id,
              tool_name: item.name,
            })
          }
          const argumentsText = typeof item.arguments === 'string' ? item.arguments : ''
          if (argumentsText !== '') {
            const delta = this.streamDelta(this.previousArguments, key, argumentsText, argsMode)
            if (delta !== '') {
              events.push({
                type: EVENT_FUNCTION_CALL_ARGUMENTS_DELTA,
                response_id: response.id,
                model: response.model,
                output_index: slot,
                tool_call_index: slot,
                tool_call_id: item.call_id,
                tool_name: item.name,
                tool_arguments_delta: delta,
              })
            }
          }
          break
        }
        case 'reasoning': {
          const text = item.reasoning?.text
            ?? (item.content ?? []).map((part) => part.reasoning_text ?? part.text ?? '').join('')
          const delta = this.streamDelta(this.previousReasoning, `reasoning_${outputIndex}`, text, this.modeReasoning)
          if (delta !== '') {
            events.push({
              type: EVENT_REASONING_DELTA,
              response_id: response.id,
              model: response.model,
              output_index: outputIndex,
              item_id: item.id,
              reasoning_delta: delta,
            })
          }
          break
        }
        default:
          events = [...events, ...this.contentPartEvents(response, item, outputIndex)]
      }
    })
    if (response.usage) {
      events.push({
        type: EVENT_USAGE_DELTA,
        response_id: response.id,
        model: response.model,
        usage: response.usage,
      })
    }
    return events
  }

  /** 产生一条消息输出项的内容部件增量（文本/推理/拒绝/其他）。 */
  private contentPartEvents(response: MaheshvaraResponse, item: MaheshvaraOutputItem, outputIndex: number): MaheshvaraStreamEvent[] {
    const events: MaheshvaraStreamEvent[] = []
    ;(item.content ?? []).forEach((part, contentIndex) => {
      const key = `${outputIndex}:${contentIndex}`
      switch (part.type) {
        case 'text': {
          const delta = this.streamDelta(this.previousText, key, part.text ?? '', this.modeText)
          if (delta !== '') {
            events.push({
              type: EVENT_TEXT_DELTA,
              response_id: response.id,
              model: response.model,
              output_index: outputIndex,
              content_index: contentIndex,
              item_id: item.id,
              delta,
            })
          }
          break
        }
        case 'reasoning': {
          const text = firstNonEmptyString(part.reasoning_text ?? '', part.text ?? '')
          const delta = this.streamDelta(this.previousReasoning, key, text, this.modeReasoning)
          if (delta !== '') {
            events.push({
              type: EVENT_REASONING_DELTA,
              response_id: response.id,
              model: response.model,
              output_index: outputIndex,
              content_index: contentIndex,
              item_id: item.id,
              reasoning_delta: delta,
            })
          }
          break
        }
        case 'refusal': {
          const delta = this.streamDelta(this.previousText, `refusal:${outputIndex}:${contentIndex}`, part.text ?? '', this.modeText)
          if (delta !== '') {
            events.push({
              type: EVENT_REFUSAL_DELTA,
              response_id: response.id,
              model: response.model,
              output_index: outputIndex,
              content_index: contentIndex,
              item_id: item.id,
              refusal_delta: delta,
            })
          }
          break
        }
        default:
          events.push({
            type: EVENT_CONTENT_PART_ADDED,
            response_id: response.id,
            model: response.model,
            output_index: outputIndex,
            content_index: contentIndex,
            item_id: item.id,
            content_part: part,
          })
      }
    })
    return events
  }

  private streamDelta(previous: Map<string, string>, key: string, current: string, mode: string): string {
    if (mode !== 'cumulative') return current
    const before = previous.get(key) ?? ''
    previous.set(key, current)
    if (current === before) return ''
    if (current.startsWith(before)) return current.slice(before.length)
    return current
  }
}

/**
 * 把命中的帧规则叠加到协议配置副本上：帧映射覆盖默认映射，payloadPath
 * 缺省继承流级配置。帧内 response 不得再携带流配置（校验已保证）。
 */
function customProtocolFrameConfig(config: CustomProtocolConfig, frame: CustomProtocolStreamFrame): CustomProtocolConfig {
  const stream = { ...(config.response?.stream ?? {}) }
  const payloadPath = (frame.payloadPath ?? '').trim()
  if (payloadPath !== '') stream.payloadPath = payloadPath
  if (frame.response) {
    stream.response = { ...frame.response, stream: undefined }
  }
  return {
    ...config,
    response: { ...(config.response ?? {}), stream },
  }
}

/** 校验并构造流解码器（外部传入的协议配置：预览/测试等非注册路径）。 */
export function createCustomProtocolStreamDecoder(config: CustomProtocolConfig): CustomProtocolStreamDecoder {
  validateCustomProtocol(config)
  return new CustomProtocolStreamDecoder(config)
}
