/**
 * 四大线协议的预置（preset）定义：协议即数据的参照实现。
 * 逐字段转写自 Elysia-Api（Go）`backend/server/presets/*.json`（v1.4.0），
 * metadata.preset 标记预置身份；复制后可定制端点/字段。
 * 交叉验证测试用它们驱动引擎，与内置四协议解码器的产出对拍。
 */

import type { CustomProtocolConfig } from './types.js'

export const OPENAI_CHAT_PRESET: CustomProtocolConfig = {
  id: 'openai-chat',
  name: 'OpenAI Chat Completions（预置）',
  version: '1',
  type: 'llm',
  metadata: {
    preset: true,
    description: 'OpenAI Chat Completions 线制的预置定义；复制后可定制端点/字段',
  },
  request: {
    method: 'POST',
    path: '/v1/chat/completions',
    shape: 'openai-chat',
    body: {
      model: { field: 'model', mode: 'string' },
      messages: { field: 'messages' },
      stream: { field: 'stream' },
      stream_options: {
        include_usage: {
          field: 'stream_options.include_usage',
          default: true,
          when: { path: 'stream', op: 'isTrue' },
        },
      },
      max_tokens: { field: 'max_output_tokens', omitIfEmpty: true },
      temperature: { field: 'temperature', omitIfEmpty: true },
      top_p: { field: 'top_p', omitIfEmpty: true },
      tools: { field: 'tools', omitIfEmpty: true },
      tool_choice: { field: 'tool_choice', omitIfEmpty: true },
      response_format: { field: 'response_format', omitIfEmpty: true },
    },
  },
  response: {
    textPath: 'choices[0].message.content',
    reasoningPath: 'choices[0].message.reasoning_content',
    toolCallsPath: 'choices[0].message.tool_calls',
    usagePath: 'usage',
    finishReasonPath: 'choices[0].finish_reason',
    stream: {
      mode: 'delta',
      frames: [
        {
          match: { path: 'error', op: 'notNull' },
          response: { errorPath: 'error' },
        },
        {
          match: { path: 'choices[0].delta.tool_calls', op: 'nonEmpty' },
          tool: {
            path: 'choices[0].delta.tool_calls',
            indexPath: 'index',
            idPath: 'id',
            namePath: 'function.name',
            argumentsPath: 'function.arguments',
          },
          response: {
            textPath: 'choices[0].delta.content',
            reasoningPath: 'choices[0].delta.reasoning_content',
            usagePath: 'usage',
            finishReasonPath: 'choices[0].finish_reason',
          },
        },
        {
          match: { path: 'choices[0]', op: 'isNull' },
          response: { usagePath: 'usage' },
        },
        {
          match: { path: 'choices', op: 'nonEmpty' },
          response: {
            textPath: 'choices[0].delta.content',
            reasoningPath: 'choices[0].delta.reasoning_content',
            usagePath: 'usage',
            finishReasonPath: 'choices[0].finish_reason',
          },
        },
      ],
    },
  },
  models: {
    path: '/v1/models',
    listPath: 'data',
  },
  aliases: {},
}

export const ANTHROPIC_MESSAGES_PRESET: CustomProtocolConfig = {
  id: 'anthropic-messages',
  name: 'Anthropic Messages（预置）',
  version: '1',
  type: 'llm',
  metadata: {
    preset: true,
    description: 'Anthropic Messages 线制的预置定义；含 thinking 分块与分帧工具拼装',
  },
  aliases: {
    toolCall: {
      id: ['id'],
      name: ['name'],
      arguments: ['input'],
    },
    textKeys: ['text', 'content', 'message', 'value', 'output', 'thinking'],
  },
  request: {
    method: 'POST',
    path: '/v1/messages',
    shape: 'anthropic',
    headers: {
      'anthropic-version': '2023-06-01',
    },
    auth: {
      mode: 'header',
      header: 'x-api-key',
    },
    body: {
      model: { field: 'model', mode: 'string' },
      messages: { field: 'messages' },
      system: { field: 'instructions', mode: 'string', omitIfEmpty: true },
      max_tokens: { field: 'max_output_tokens', default: 65536 },
      stream: { field: 'stream' },
      temperature: { field: 'temperature', omitIfEmpty: true },
      top_p: { field: 'top_p', omitIfEmpty: true },
      tools: { field: 'tools', omitIfEmpty: true },
      tool_choice: { field: 'tool_choice', omitIfEmpty: true },
    },
  },
  response: {
    textPath: 'content',
    textFilter: { path: 'type', op: 'equals', value: 'text' },
    reasoningPath: 'content',
    reasoningFilter: { path: 'type', op: 'equals', value: 'thinking' },
    toolCallsPath: 'content',
    usagePath: 'usage',
    finishReasonPath: 'stop_reason',
    stream: {
      frames: [
        { event: 'error', response: { errorPath: 'error' } },
        { event: 'message_start', response: { usagePath: 'message.usage' } },
        {
          event: 'content_block_start',
          match: { path: 'content_block.type', op: 'equals', value: 'tool_use' },
          tool: {
            indexPath: 'index',
            idPath: 'content_block.id',
            namePath: 'content_block.name',
          },
        },
        {
          event: 'content_block_delta',
          match: { path: 'delta.type', op: 'equals', value: 'text_delta' },
          response: { textPath: 'delta.text' },
        },
        {
          event: 'content_block_delta',
          match: { path: 'delta.type', op: 'equals', value: 'thinking_delta' },
          response: { reasoningPath: 'delta.thinking' },
        },
        {
          event: 'content_block_delta',
          match: { path: 'delta.type', op: 'equals', value: 'input_json_delta' },
          tool: {
            indexPath: 'index',
            argumentsPath: 'delta.partial_json',
          },
        },
        {
          event: 'message_delta',
          terminal: true,
          response: {
            usagePath: 'usage',
            finishReasonPath: 'delta.stop_reason',
          },
        },
      ],
    },
  },
  models: {
    path: '/v1/models',
    listPath: 'data',
  },
}

export const GEMINI_GENERATE_PRESET: CustomProtocolConfig = {
  id: 'gemini-generate',
  name: 'Google Gemini generateContent（预置）',
  version: '1',
  type: 'llm',
  metadata: {
    preset: true,
    description: 'Gemini 线制的预置定义；双路径按流切换、thought 谓词分流',
  },
  aliases: {
    toolCall: {
      id: ['functionCall.name'],
      name: ['functionCall.name'],
      arguments: ['functionCall.args'],
    },
  },
  request: {
    method: 'POST',
    path: '/v1beta/models/{{maheshvara.model}}:generateContent',
    pathStream: '/v1beta/models/{{maheshvara.model}}:streamGenerateContent?alt=sse',
    shape: 'gemini',
    auth: {
      mode: 'header',
      header: 'x-goog-api-key',
    },
    body: {
      contents: { field: 'messages' },
      systemInstruction: {
        parts: [
          { text: { field: 'instructions', mode: 'string' } },
        ],
      },
      generationConfig: {
        temperature: { field: 'temperature', omitIfEmpty: true },
        maxOutputTokens: { field: 'max_output_tokens', omitIfEmpty: true },
        topP: { field: 'top_p', omitIfEmpty: true },
        thinkingConfig: {
          includeThoughts: {
            field: 'thinking.enabled',
            when: { path: 'thinking.enabled', op: 'isTrue' },
          },
        },
      },
      tools: { field: 'tools', omitIfEmpty: true },
    },
  },
  response: {
    textPath: 'candidates[0].content.parts',
    textFilter: [
      { path: 'thought', op: 'isFalse' },
      { path: 'functionCall', op: 'isNull' },
    ],
    reasoningPath: 'candidates[0].content.parts',
    reasoningFilter: [
      { path: 'thought', op: 'isTrue' },
    ],
    toolCallsPath: 'candidates[0].content.parts',
    usagePath: 'usageMetadata',
    finishReasonPath: 'candidates[0].finishReason',
    stream: {
      mode: 'delta',
      frames: [
        {
          match: { path: 'error', op: 'notNull' },
          response: { errorPath: 'error' },
        },
        {
          match: { path: 'candidates[0].content.parts[0].functionCall', op: 'notNull' },
          response: {
            toolCallsPath: 'candidates[0].content.parts',
            usagePath: 'usageMetadata',
            finishReasonPath: 'candidates[0].finishReason',
          },
        },
        {
          match: { path: 'candidates[0].finishReason', op: 'notNull' },
          terminal: true,
          response: {
            textPath: 'candidates[0].content.parts',
            textFilter: [
              { path: 'thought', op: 'isFalse' },
              { path: 'functionCall', op: 'isNull' },
            ],
            reasoningPath: 'candidates[0].content.parts',
            reasoningFilter: [
              { path: 'thought', op: 'isTrue' },
            ],
            usagePath: 'usageMetadata',
            finishReasonPath: 'candidates[0].finishReason',
          },
        },
        {
          match: { path: 'candidates[0]', op: 'isNull' },
          response: { usagePath: 'usageMetadata' },
        },
        {
          match: { path: 'candidates', op: 'nonEmpty' },
          response: {
            textPath: 'candidates[0].content.parts',
            textFilter: [
              { path: 'thought', op: 'isFalse' },
              { path: 'functionCall', op: 'isNull' },
            ],
            reasoningPath: 'candidates[0].content.parts',
            reasoningFilter: [
              { path: 'thought', op: 'isTrue' },
            ],
            usagePath: 'usageMetadata',
            finishReasonPath: 'candidates[0].finishReason',
          },
        },
      ],
      doneValuesReplace: true,
    },
  },
}

export const OPENAI_RESPONSES_PRESET: CustomProtocolConfig = {
  id: 'openai-responses',
  name: 'OpenAI Responses（预置）',
  version: '1',
  type: 'llm',
  metadata: {
    preset: true,
    description: 'OpenAI Responses 线制的预置定义；类型化事件流 + 分帧工具拼装',
  },
  request: {
    method: 'POST',
    path: '/v1/responses',
    shape: 'responses',
    body: {
      model: { field: 'model', mode: 'string' },
      input: { field: 'input_items' },
      instructions: { field: 'instructions', mode: 'string', omitIfEmpty: true },
      stream: { field: 'stream' },
      max_output_tokens: { field: 'max_output_tokens', omitIfEmpty: true },
      temperature: { field: 'temperature', omitIfEmpty: true },
      top_p: { field: 'top_p', omitIfEmpty: true },
      tools: { field: 'tools', omitIfEmpty: true },
      tool_choice: { field: 'tool_choice', omitIfEmpty: true },
      reasoning: { field: 'reasoning', omitIfEmpty: true },
    },
  },
  response: {
    textPath: 'output',
    textFilter: { path: 'type', op: 'equals', value: 'message' },
    reasoningPath: 'output',
    reasoningFilter: { path: 'type', op: 'equals', value: 'reasoning' },
    toolCallsPath: 'output',
    usagePath: 'usage',
    stream: {
      frames: [
        {
          event: 'response.failed',
          payloadPath: 'response',
          response: { errorPath: 'error' },
        },
        {
          event: 'response.output_text.delta',
          response: { textPath: 'delta' },
        },
        {
          event: 'response.reasoning_text.delta',
          response: { reasoningPath: 'delta' },
        },
        {
          event: 'response.output_item.added',
          match: { path: 'item.type', op: 'equals', value: 'function_call' },
          tool: {
            indexPath: 'output_index',
            idPath: 'item.call_id',
            namePath: 'item.name',
          },
        },
        {
          event: 'response.function_call_arguments.delta',
          tool: {
            indexPath: 'output_index',
            argumentsPath: 'delta',
          },
        },
        {
          event: 'response.completed',
          terminal: true,
          payloadPath: 'response',
          response: { usagePath: 'usage' },
        },
      ],
    },
  },
  models: {
    path: '/v1/models',
    listPath: 'data',
  },
  aliases: {
    textKeys: ['text', 'content', 'summary'],
  },
}

export const CUSTOM_PROTOCOL_PRESETS: CustomProtocolConfig[] = [
  OPENAI_CHAT_PRESET,
  ANTHROPIC_MESSAGES_PRESET,
  GEMINI_GENERATE_PRESET,
  OPENAI_RESPONSES_PRESET,
]
