/**
 * LLM 工具调用循环（调用方驱动）。
 *
 * brain.execute 保持无状态单轮；本助手把"模型请求工具 → 调用方执行 →
 * tool 角色消息回填 → 再次调用"的循环收敛为一处，供 agentic 对话等场景复用。
 *
 * 约定：
 * - 循环内不做消息窗口截断（assistant toolCalls 与 tool 回填必须成对保留），
 *   上层如需控制长度应在传入前自行裁剪 request.messages；
 * - 未知工具名返回结构化错误文本（模型可自纠），不中断循环；
 * - 工具执行异常同样以错误文本回填，保证循环有确定出口。
 */

import type { BrainRequest, BrainService } from '@elysia-ai/core'
import type { DialogueMessage, ToolCall } from '@elysia-ai/core'
import { parseToolCallArguments } from '@elysia-ai/core'

/** 工具执行器：入参为已归一的对象，返回值序列化为 tool 消息内容。 */
export type BrainToolExecutor = (args: Record<string, unknown>) => Promise<unknown>

export interface BrainToolEntry {
  /** 工具定义（下发给模型） */
  definition: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
  /** 本地执行器 */
  execute: BrainToolExecutor
}

export interface ToolExchangeRecord {
  name: string
  arguments: Record<string, unknown>
  result: unknown
}

export interface ToolLoopResult {
  /** 模型最终一轮纯文本输出（未调用输出类工具时可能为空串） */
  output: string
  /** 全部轮次产出的工具调用（按发生顺序） */
  toolCalls: ToolCall[]
  /** 实际执行成功的工具交换记录 */
  executed: ToolExchangeRecord[]
  /** 含工具交换的完整消息序列（可直接作为会话历史落库） */
  messages: DialogueMessage[]
  rounds: number
  stopReason: 'completed' | 'max-rounds'
}

export interface RunToolLoopOptions {
  /** 最大模型轮次（默认 6，参照 vtuber 认知引擎上限） */
  maxRounds?: number
}

export async function runBrainToolLoop(
  brain: BrainService,
  request: BrainRequest,
  tools: BrainToolEntry[],
  options: RunToolLoopOptions = {},
): Promise<ToolLoopResult> {
  const maxRounds = options.maxRounds ?? 6
  const executors = new Map<string, BrainToolExecutor>()
  for (const entry of tools) executors.set(entry.definition.name, entry.execute)
  const definitions = tools.map((entry) => entry.definition)

  const toolRequest: BrainRequest = {
    ...request,
    tools: definitions.length ? definitions : undefined,
    // 循环期间禁止窗口截断：tool 消息与 assistant toolCalls 必须成对
    contextWindow: 0,
  }

  let messages: DialogueMessage[] = [...request.messages]
  const allToolCalls: ToolCall[] = []
  const executed: ToolExchangeRecord[] = []
  let output = ''
  let stopReason: ToolLoopResult['stopReason'] = 'completed'
  let roundsUsed = 0

  for (let round = 1; round <= maxRounds; round++) {
    roundsUsed = round
    const response = await brain.execute({ ...toolRequest, messages })
    output = response.output
    const toolCalls = response.toolCalls ?? []

    if (!toolCalls.length) {
      stopReason = 'completed'
      const echoed = stripLeadingSystem(response.messages)
      if (echoed.length) {
        messages = echoed[echoed.length - 1]?.role === 'assistant'
          ? echoed
          : [...echoed, { role: 'assistant' as const, content: response.output }]
      } else {
        messages = [...messages, { role: 'assistant' as const, content: response.output }]
      }
      break
    }

    allToolCalls.push(...toolCalls)
    // 网关侧 assistant 回显已带 toolCalls；防御性兜底自行补一条。
    // 回显含 brain 每轮前插的 system 消息——采纳前剥离头部 system，
    // 否则第 N 轮请求携带 N 条 system（persona 重复 N 遍）。
    const echoed = stripLeadingSystem(response.messages)
    if (echoed.length && echoed[echoed.length - 1]?.role === 'assistant') {
      messages = echoed
    } else {
      messages = [...messages, { role: 'assistant', content: response.output, toolCalls }]
    }

    for (const call of toolCalls) {
      const args = parseToolCallArguments(call)
      let result: unknown
      try {
        const executor = executors.get(call.name ?? '')
        if (!executor) {
          result = { ok: false, code: 'unknown-tool', message: `Tool "${call.name}" is not available` }
        } else {
          result = await executor(args)
        }
      } catch (error) {
        result = {
          ok: false,
          code: 'tool-error',
          message: error instanceof Error ? error.message : String(error),
        }
      }
      executed.push({ name: call.name ?? '', arguments: args, result })
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: serializeToolResult(result),
      })
    }

    if (round === maxRounds) {
      stopReason = 'max-rounds'
    }
  }

  return { output, toolCalls: allToolCalls, executed, messages, rounds: roundsUsed, stopReason }
}

function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined) return ''
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

/** 剥离回显消息头部的 system 角色消息（brain 每轮都会重插 system）。 */
function stripLeadingSystem(messages: DialogueMessage[] | undefined): DialogueMessage[] {
  if (!messages?.length) return []
  const copy = [...messages]
  while (copy.length > 0 && copy[0].role === 'system') copy.shift()
  return copy
}
