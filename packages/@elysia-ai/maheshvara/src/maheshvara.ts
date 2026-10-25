/**
 * Elysia Maheshvara 统一模型（TypeScript 权威版本）。
 *
 * 本文件与 Elysia-Api（Go）`backend/relay/maheshvara_types.go` 逐字段对齐：
 * - 属性名与 Go 结构体的 JSON 标签完全一致（snake_case），
 *   因此 `JSON.parse` 出的线上对象可以直接断言为本模块的类型，
 *   Go 与 TS 两套测试可共享同一批 golden fixture。
 * - Go 的 `json.RawMessage` / `any` 对应 `unknown`；
 *   `map[string]any` 对应 `Record<string, unknown>`。
 * - `RawExtra` / `Raw` 系列字段承担保真透传职责：解析方把协议里
 *   Maheshvara 未显式建模的未知字段原样存进去，构造方在需要时回填，
 *   保证 X → Maheshvara → Y 的转换不丢厂商私有扩展。
 */

/** 流式请求选项。 */
export interface MaheshvaraStreamOptions {
  include_usage?: boolean
  include_obfuscation?: boolean
  raw?: Record<string, unknown>
}

/** 单条消息。content 为多模态部件数组；role 为 user/assistant/tool 等。 */
export interface MaheshvaraMessage {
  role: string
  content?: MaheshvaraContentPart[]
  tool_calls?: MaheshvaraToolCall[]
  tool_call_id?: string
  name?: string
  audio?: MaheshvaraAudioConfig
  cache_control?: unknown
  metadata?: Record<string, unknown>
  /** 解析时捕获的未建模字段（Go: `json:"-"`，不参与 maheshvara 自身的序列化）。 */
  RawExtra?: Record<string, unknown>
}

/**
 * 多模态内容部件。一个部件按 type 取用对应字段组：
 * text / image（url 或 base64）/ audio / video / file / tool_output /
 * reasoning / 缓存控制等，未识别内容走 raw。
 */
export interface MaheshvaraContentPart {
  type: string

  text?: string

  image_url?: string
  image_base64?: string
  media_type?: string
  mime_type?: string
  uri?: string
  detail?: string

  audio_url?: string
  audio_base64?: string
  video_url?: string
  video_base64?: string
  data?: string
  thought?: boolean

  file_id?: string
  file_name?: string
  file_data?: string

  tool_call_id?: string
  tool_output?: string

  reasoning_text?: string
  signature?: string
  signature_provider?: string
  encrypted_content?: string
  /** 密文签发方与签发时模型（信封 v2 铸造/回放门控用）。 */
  encrypted_provider?: string
  encrypted_model?: string
  reasoning_summary?: MaheshvaraReasoningSummary[]
  /** 原样承载 Claude text block 的引用标注（来源出处脚注），回放时逐字写回。 */
  citations?: Record<string, unknown>[]
  cache_control?: unknown
  annotations?: Record<string, unknown>[]
  metadata?: Record<string, unknown>

  raw?: unknown
}

/** Responses 风格的输入项（item 级而非 message 级）。 */
export interface MaheshvaraInputItem {
  type: string
  role?: string
  content?: MaheshvaraContentPart[]
  call_id?: string
  output?: string
  item_id?: string
  reasoning?: MaheshvaraReasoning
  RawExtra?: Record<string, unknown>
}

/** 工具定义。parameters（OpenAI 风格）与 input_schema（Anthropic 风格）二选一。 */
export interface MaheshvaraTool {
  type: string
  name?: string
  description?: string
  parameters?: Record<string, unknown>
  input_schema?: Record<string, unknown>
  strict?: boolean
  provider?: string
  config?: Record<string, unknown>
  cache_control?: unknown

  /** OpenAI 内置 web_search 工具的参数。 */
  search_context_size?: string
  vector_store_ids?: string[]

  raw?: Record<string, unknown>
}

/** 一次工具调用（assistant 侧产出）。arguments 为原始 JSON 值。 */
export interface MaheshvaraToolCall {
  id?: string
  type: string
  name?: string
  arguments?: unknown
  /** 原始 JSON 文本。部分上游只回传未解析的参数字符串时保留在这里。 */
  arguments_text?: string
  thought_signature?: string
  thought_signature_provider?: string
  raw?: Record<string, unknown>
}

/** 推理/思考配置与产出。 */
export interface MaheshvaraReasoning {
  effort?: string
  summary?: string
  summary_parts?: MaheshvaraReasoningSummary[]
  text?: string
  encrypted_content?: string
  raw?: Record<string, unknown>
}

/** 思考开关（Anthropic thinking / Gemini thinkingConfig 风格）。 */
export interface MaheshvaraThinking {
  enabled: boolean
  effort?: string
  /** Claude 4.5+ 自适应思考：无固定预算，力度经 output_config.effort 下发。 */
  adaptive?: boolean
  budget_tokens?: number
  include_summary?: boolean
}

/** 音频输出配置（TTS / 音频模态输出）。 */
export interface MaheshvaraAudioConfig {
  voice?: string
  format?: string
  codec?: string
  sample_rate?: number
  channels?: number
}

/** Gemini 风格的安全设置。 */
export interface MaheshvaraSafetySetting {
  category?: string
  threshold?: string
  action?: string
}

/** 结构化输出（JSON Schema / json_object）。 */
export interface MaheshvaraResponseFormat {
  type: string
  name?: string
  description?: string
  schema?: Record<string, unknown>
  strict?: boolean
  raw?: Record<string, unknown>
}

/**
 * 统一请求。字段覆盖四种协议的公共能力与各家扩展；
 * 未知厂商字段解析进 RawExtra，由构造方决定是否透传。
 */
export interface MaheshvaraRequest {
  model: string
  instructions?: string

  messages?: MaheshvaraMessage[]
  input_items?: MaheshvaraInputItem[]

  max_output_tokens?: number
  min_output_tokens?: number
  max_tool_calls?: number
  n?: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop?: unknown
  seed?: number

  presence_penalty?: number
  frequency_penalty?: number
  repetition_penalty?: number
  logprobs?: boolean
  top_logprobs?: number
  typical_p?: number
  min_p?: number
  top_a?: number

  stream?: boolean
  stream_options?: MaheshvaraStreamOptions

  tools?: MaheshvaraTool[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean

  response_format?: MaheshvaraResponseFormat
  reasoning?: MaheshvaraReasoning
  thinking?: MaheshvaraThinking
  modalities?: string[]
  audio?: MaheshvaraAudioConfig
  prediction?: unknown
  service_tier?: string
  safety_identifier?: string
  verbosity?: string
  safety_settings?: MaheshvaraSafetySetting[]
  cache_control?: unknown

  user?: string
  metadata?: Record<string, unknown>

  previous_response_id?: string
  store?: boolean
  include?: string[]
  truncation?: string
  background?: boolean
  conversation?: unknown
  prompt?: unknown

  prompt_cache_key?: string
  prompt_cache_retention?: unknown
  request_id?: string
  session_id?: string
  timeout_ms?: number

  RawExtra?: Record<string, unknown>
}

/** 统一响应（非流式）。 */
export interface MaheshvaraResponse {
  id: string
  model: string
  created_at: number
  status: string

  output?: MaheshvaraOutputItem[]

  stop_reason?: string
  incomplete_details?: Record<string, unknown>
  metadata?: Record<string, unknown>
  service_tier?: string
  system_fingerprint?: string

  usage?: MaheshvaraUsage
  error?: MaheshvaraError

  RawExtra?: Record<string, unknown>
}

/** 响应输出项：消息 / 工具调用 / 推理等。 */
export interface MaheshvaraOutputItem {
  id?: string
  type: string
  status?: string
  role?: string

  content?: MaheshvaraContentPart[]

  call_id?: string
  name?: string
  arguments?: unknown
  tool_calls?: MaheshvaraToolCall[]
  reasoning?: MaheshvaraReasoning

  summary?: MaheshvaraReasoningSummary[]
  metadata?: Record<string, unknown>

  raw?: Record<string, unknown>
}

/** 推理摘要部件。 */
export interface MaheshvaraReasoningSummary {
  type?: string
  text?: string
}

/**
 * 统一用量。基本三段为必有字段；其余按上游支持情况可选填充，
 * estimated 系列与 estimated 标记用于无精确计量时的估算值。
 */
export interface MaheshvaraUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number

  cached_input_tokens?: number
  cache_creation_input_tokens?: number
  /** Claude 双 TTL 缓存写入分桶（5m/1h）。 */
  cache_creation_5m_tokens?: number
  cache_creation_1h_tokens?: number
  /** 服务端工具提示词计费 token（Claude server_tool_use 等）。 */
  tool_prompt_tokens?: number
  reasoning_tokens?: number

  text_input_tokens?: number
  text_output_tokens?: number
  image_input_tokens?: number
  image_output_tokens?: number
  audio_input_tokens?: number
  audio_output_tokens?: number
  tool_use_tokens?: number
  accepted_prediction_tokens?: number
  rejected_prediction_tokens?: number

  web_search_call_count?: number
  file_search_call_count?: number
  image_generation_call_count?: number
  code_interpreter_call_count?: number
  computer_use_call_count?: number

  estimated_input_tokens?: number
  estimated_output_tokens?: number
  estimated_total_tokens?: number
  estimated?: boolean

  source?: string
  raw?: Record<string, unknown>
  provider?: string
}

/**
 * 统一错误。
 * class 为稳定分类（errors.ts 的 ErrorClass 值域），四线制的 type/status/code
 * 均由它派生；status 携带上游真实 HTTP 状态码（0/未设 = 按分类推导）。
 */
export interface MaheshvaraError {
  message: string
  type?: string
  param?: string
  code?: string
  class?: string
  status?: number
  details?: unknown
  raw?: Record<string, unknown>
}

/**
 * 统一流事件。type 决定哪些字段有值：
 * 文本增量（delta / text_done）、工具调用增量、推理增量、拒绝增量、
 * 完成（finish_reason + usage）、错误、以及 Responses 风格的
 * 完整对象快照（response / output_item / content_part）。
 */
export interface MaheshvaraStreamEvent {
  type: string

  response_id?: string
  item_id?: string
  model?: string
  status?: string

  output_index?: number
  content_index?: number

  role?: string

  delta?: string
  text_done?: string

  tool_call_id?: string
  tool_call_index?: number
  tool_name?: string
  tool_arguments_delta?: string
  tool_arguments_done?: string
  reasoning_delta?: string
  reasoning_done?: string
  reasoning_signature_delta?: string
  reasoning_signature_provider?: string
  refusal_delta?: string
  refusal_done?: string
  finish_reason?: string
  stop_sequence?: string
  choice_index?: number
  sequence?: number
  created_at?: number

  /** 随文本事件携带的出处标注（Gemini grounding 包装 / Claude citations）。 */
  annotations?: Record<string, unknown>[]

  usage?: MaheshvaraUsage
  response?: MaheshvaraResponse
  output_item?: MaheshvaraOutputItem
  content_part?: MaheshvaraContentPart
  error?: MaheshvaraError

  raw?: Record<string, unknown>
}

/**
 * 计算终态完整值相对已累计增量的差分（Go deltaVsAccumulated）：
 * 相等则无输出、终值以累计值为前缀则只补后缀、否则整体替换
 * （replaced=true，调用方负责重置累计器并输出完整 delta）。
 * 流解码器处理"终块携带完整快照"的上游时用它避免重复拼接。
 */
export function deltaVsAccumulated(accumulated: string, complete: string): { delta: string; replaced: boolean } {
  if (complete === accumulated) return { delta: '', replaced: false }
  if (complete.startsWith(accumulated)) return { delta: complete.slice(accumulated.length), replaced: false }
  return { delta: complete, replaced: true }
}

/**
 * 原始对象为底、类型化非空字段覆盖其上（Go mergeRawOverTyped 的对象版）：
 * 服务端工具项载荷 / usage 未知键等往返保真的统一机制。
 */
export function mergeRawOverTyped(
  raw: Record<string, unknown> | undefined,
  typed: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw }
  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined && value !== null) merged[key] = value
  }
  return merged
}
