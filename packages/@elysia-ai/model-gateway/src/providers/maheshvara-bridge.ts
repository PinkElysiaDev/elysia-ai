/**
 * 网关内部请求（DialogueMessage）→ maheshvara 请求的桥接。
 * DialogueMessage.content 目前是纯字符串；映射为单个 text 部件，
 * 由各协议 encode 侧决定是否折叠回字符串（OpenAI 系）或 text block（Claude/Gemini）。
 * 将来 DialogueMessage 扩展为多模态部件数组时，只需替换这一个文件。
 *
 * 工具调用通道：
 * - 请求侧：ProviderRequest.tools → MaheshvaraRequest.tools（function 类型）；
 *   assistant 消息的 toolCalls → MaheshvaraMessage.tool_calls；
 *   tool 角色消息 → CONTENT_TOOL_OUTPUT 部件（协议 encode 侧展开为各自格式）。
 * - 响应侧：见 extract-tool-calls.ts。
 */

import type { DialogueMessage, ToolDefinition } from '@elysia-ai/core'
import type { MaheshvaraRequest, MaheshvaraTool } from '@elysia-ai/maheshvara'
import { CONTENT_TEXT, CONTENT_TOOL_OUTPUT, TOOL_FUNCTION } from '@elysia-ai/maheshvara'
import type { ProviderRequest } from './types.js'

export interface MaheshvaraBridgeParams {
  model: string
  maxTokens: number
  temperature: number
  /** o 系模型要求的 token 上限字段名：写入 RawExtra，由协议 encode 侧回写原字段名。 */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
}

export function toMaheshvaraRequest(request: ProviderRequest, params: MaheshvaraBridgeParams): MaheshvaraRequest {
  return {
    model: params.model,
    messages: toMaheshvaraMessages(request.messages),
    max_output_tokens: params.maxTokens,
    temperature: params.temperature,
    ...(request.tools?.length ? { tools: toMaheshvaraTools(request.tools) } : {}),
    ...(request.toolChoice !== undefined ? { tool_choice: request.toolChoice } : {}),
    ...(request.parallelToolCalls !== undefined ? { parallel_tool_calls: request.parallelToolCalls } : {}),
    ...(params.maxTokensField === 'max_completion_tokens'
      ? { RawExtra: { max_tokens_field: 'max_completion_tokens' } }
      : {}),
  }
}

function toMaheshvaraTools(tools: ToolDefinition[]): MaheshvaraTool[] {
  return tools.map((tool) => ({
    type: TOOL_FUNCTION,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
  }))
}

export function toMaheshvaraMessages(messages: DialogueMessage[]): MaheshvaraRequest['messages'] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      // 工具结果只经 tool_output 部件承载：openai encode 侧消息级 tool_call_id/name
      // 会触发额外空消息发射（与部件级重复），anthropic 则按部件展开 tool_result。
      return {
        role: 'tool',
        content: [{
          type: CONTENT_TOOL_OUTPUT,
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          tool_output: message.content,
        }],
      }
    }
    return {
      role: message.role,
      content: message.content === '' ? [] : [{ type: CONTENT_TEXT, text: message.content }],
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls } : {}),
    }
  })
}
