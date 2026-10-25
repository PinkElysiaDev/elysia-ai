/**
 * 协议设计器的字段目录与约束（校验、UI 下拉与 AI 提示词共用的单一事实来源）。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol_mapping.go` 的目录块逐条对齐。
 */

import type {
  CustomProtocolSchema,
  CustomProtocolTypeSpec,
  MaheshvaraFieldSpec,
} from './types.js'
import { CUSTOM_PROTOCOL_TYPE_EMBEDDING, CUSTOM_PROTOCOL_TYPE_LLM, CUSTOM_PROTOCOL_TYPE_RERANKER } from './types.js'

/** 请求字段目录：name 即模板上下文 maheshvara.<name> 的字段路径。 */
export const customProtocolRequestFieldCatalog: MaheshvaraFieldSpec[] = [
  { name: 'model', label: '模型名（路由后实际使用的上游模型）', shape: 'string', group: '基础' },
  { name: 'instructions', label: '系统指令', shape: 'string', group: '基础' },
  { name: 'messages', label: '消息数组（role + content）', shape: 'native', group: '基础' },
  { name: 'input_items', label: 'Responses 风格输入项', shape: 'native', group: '基础' },
  { name: 'stream', label: '是否流式', shape: 'scalar', group: '基础' },
  { name: 'stream_options', label: '流式选项', shape: 'native', group: '基础' },
  { name: 'tools', label: '工具定义数组', shape: 'native', group: '工具' },
  { name: 'tool_choice', label: '工具选择策略', shape: 'native', group: '工具' },
  { name: 'parallel_tool_calls', label: '允许并行工具调用', shape: 'scalar', group: '工具' },
  { name: 'max_output_tokens', label: '最大输出 token 数', shape: 'scalar', group: '生成参数' },
  { name: 'min_output_tokens', label: '最小输出 token 数', shape: 'scalar', group: '生成参数' },
  { name: 'temperature', label: '温度', shape: 'scalar', group: '生成参数' },
  { name: 'top_p', label: 'Top-P', shape: 'scalar', group: '生成参数' },
  { name: 'top_k', label: 'Top-K', shape: 'scalar', group: '生成参数' },
  { name: 'stop', label: '停止序列', shape: 'native', group: '生成参数' },
  { name: 'seed', label: '随机种子', shape: 'scalar', group: '生成参数' },
  { name: 'presence_penalty', label: 'Presence 惩罚', shape: 'scalar', group: '生成参数' },
  { name: 'frequency_penalty', label: 'Frequency 惩罚', shape: 'scalar', group: '生成参数' },
  { name: 'repetition_penalty', label: '重复惩罚', shape: 'scalar', group: '生成参数' },
  { name: 'logprobs', label: '是否返回 logprobs', shape: 'scalar', group: '生成参数' },
  { name: 'top_logprobs', label: 'logprobs 数量', shape: 'scalar', group: '生成参数' },
  { name: 'typical_p', label: 'Typical-P', shape: 'scalar', group: '生成参数' },
  { name: 'min_p', label: 'Min-P', shape: 'scalar', group: '生成参数' },
  { name: 'top_a', label: 'Top-A', shape: 'scalar', group: '生成参数' },
  { name: 'response_format', label: '响应格式（JSON schema 等）', shape: 'native', group: '结构化输出' },
  { name: 'reasoning', label: '推理配置（effort 等）', shape: 'native', group: '推理' },
  { name: 'thinking', label: '思考配置（budget_tokens 等）', shape: 'native', group: '推理' },
  { name: 'modalities', label: '输出模态', shape: 'native', group: '多模态' },
  { name: 'audio', label: '音频配置', shape: 'native', group: '多模态' },
  { name: 'safety_settings', label: '安全设置', shape: 'native', group: '其他' },
  { name: 'service_tier', label: '服务层级', shape: 'string', group: '其他' },
  { name: 'verbosity', label: '输出详细度', shape: 'string', group: '其他' },
  { name: 'user', label: '终端用户标识', shape: 'string', group: '其他' },
  { name: 'metadata', label: '元数据', shape: 'native', group: '其他' },
  { name: 'raw_extra', label: '客户端透传的未知字段（别名 extra）', shape: 'native', group: '其他' },
]

/** 响应字段目录：name 为语义映射目标，编译时展开为直接路径或 fieldMappings。 */
export const customProtocolResponseFieldCatalog: MaheshvaraFieldSpec[] = [
  { name: 'text', label: '正文文本', shape: 'string', group: '内容' },
  { name: 'reasoning', label: '思考文本', shape: 'string', group: '内容' },
  { name: 'tool_calls', label: '工具调用数组', shape: 'native', group: '内容' },
  { name: 'usage', label: '用量对象（多键名自动识别）', shape: 'native', group: '用量' },
  { name: 'usage.input_tokens', label: '输入 token 数', shape: 'scalar', group: '用量' },
  { name: 'usage.output_tokens', label: '输出 token 数', shape: 'scalar', group: '用量' },
  { name: 'usage.total_tokens', label: '总 token 数', shape: 'scalar', group: '用量' },
  { name: 'usage.cached_input_tokens', label: '缓存命中输入 token 数', shape: 'scalar', group: '用量' },
  { name: 'usage.reasoning_tokens', label: '思考 token 数', shape: 'scalar', group: '用量' },
  { name: 'stop_reason', label: '结束原因', shape: 'string', group: '元信息' },
  { name: 'id', label: '响应 ID', shape: 'string', group: '元信息' },
  { name: 'model', label: '模型名', shape: 'string', group: '元信息' },
  { name: 'status', label: '状态', shape: 'string', group: '元信息' },
  { name: 'error', label: '错误对象', shape: 'native', group: '元信息' },
  { name: 'created_at', label: '创建时间戳（秒）', shape: 'scalar', group: '元信息' },
  { name: 'service_tier', label: '服务层级', shape: 'string', group: '元信息' },
  { name: 'system_fingerprint', label: '系统指纹', shape: 'string', group: '元信息' },
  { name: 'metadata', label: '元数据（可用 metadata.<key> 子键）', shape: 'native', group: '元信息' },
  { name: 'output', label: '输出项（结构化，配 output_items 等 transform）', shape: 'native', group: '高级' },
]

export const customProtocolTransformCatalog: string[] = [
  '', 'identity', 'raw', 'string', 'text', 'join', 'int', 'integer', 'number', 'float',
  'bool', 'boolean', 'json', 'parse_json', 'json_string', 'timestamp_ms', 'first',
  'usage', 'content_parts', 'tool_calls', 'output_items',
]

export function isSupportedCustomMappingTransform(transform: string): boolean {
  return customProtocolTransformCatalog.includes(transform.trim().toLowerCase())
}

/** 协议设计器的完整目录（单一事实来源）。 */
export function customProtocolSchema(): CustomProtocolSchema {
  const types: CustomProtocolTypeSpec[] = [
    { value: CUSTOM_PROTOCOL_TYPE_LLM, label: 'LLM（聊天/生成）', hint: '完整支持中转，四协议出入' },
    { value: CUSTOM_PROTOCOL_TYPE_RERANKER, label: 'Reranker（预留）', hint: '声明式预留：可注册与编辑，中转端点待接入' },
    { value: CUSTOM_PROTOCOL_TYPE_EMBEDDING, label: 'Embedding（预留）', hint: '声明式预留：可注册与编辑，中转端点待接入' },
  ]
  return {
    requestFields: [...customProtocolRequestFieldCatalog],
    responseFields: [...customProtocolResponseFieldCatalog],
    transforms: [...customProtocolTransformCatalog],
    modes: ['json', 'string'],
    types,
  }
}

export function lookupRequestFieldSpec(name: string): MaheshvaraFieldSpec | undefined {
  return customProtocolRequestFieldCatalog.find((spec) => spec.name === name)
}

/**
 * 校验响应映射目标：目录命中，或 metadata.<key> 子键
 * （usage.<key> 子键仍需在目录中，避免拼错静默失效）。
 */
export function validateResponseFieldName(name: string): void {
  for (const spec of customProtocolResponseFieldCatalog) {
    if (spec.name === name) return
  }
  if (name.startsWith('metadata.') && name.slice('metadata.'.length).trim() !== '') return
  throw new Error(`field ${JSON.stringify(name)} is not a Maheshvara response field`)
}
