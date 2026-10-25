/**
 * 从统一响应（MaheshvaraResponse）中提取工具调用。
 *
 * 各协议 decode 后的工具调用有两种落位形态：
 * - openai / gemini：独立 function_call 输出项，其 tool_calls 数组各含一条；
 * - anthropic / responses：独立 function_call 输出项，只有 call_id/name/arguments。
 * 两种形态在此统一收敛为 core 的 ToolCall。
 */

import type { ToolCall } from '@elysia-ai/core'
import type { MaheshvaraResponse } from '@elysia-ai/maheshvara'
import { OUTPUT_FUNCTION_CALL, TOOL_FUNCTION } from '@elysia-ai/maheshvara'

export function extractToolCalls(response: MaheshvaraResponse): ToolCall[] {
  const calls: ToolCall[] = []
  for (const item of response.output ?? []) {
    if (item.tool_calls?.length) {
      for (const call of item.tool_calls) {
        calls.push({
          id: call.id,
          type: call.type || TOOL_FUNCTION,
          name: call.name,
          // 优先已解析值；只有原始字符串时保留字符串（消费方用 parseToolCallArguments 归一）
          arguments: call.arguments ?? call.arguments_text,
        })
      }
    } else if (item.type === OUTPUT_FUNCTION_CALL) {
      calls.push({
        id: item.call_id ?? item.id,
        type: TOOL_FUNCTION,
        name: item.name,
        arguments: item.arguments,
      })
    }
  }
  return calls
}
