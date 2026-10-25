/**
 * 自定义协议引擎的类型面。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol.go` / `custom_protocol_mapping.go`
 * 的结构体族逐字段对齐；Go 的 `json.RawMessage` 对应 `unknown`（已解析的 JSON 值），
 * `map[string]string` 对应 `Record<string, string>`。
 */

/**
 * 描述一个供应商线制协议，无需向 Maheshvara 核心添加供应商逻辑。
 * 请求体是 JSON 模板或字段引用注解树；占位符可插入转义字符串或原生 JSON 值。
 * 响应路径是根在上游解码体的点路径。
 */
export interface CustomProtocolConfig {
  id: string
  name?: string
  version?: string
  type?: string
  request: CustomProtocolRequest
  response?: CustomProtocolResponse
  models?: CustomProtocolModels
  /** 别名覆盖提取阶段的键名表；提供即整体替换该类默认表。 */
  aliases?: CustomProtocolAliases
  metadata?: Record<string, unknown>
}

/**
 * 让键名不符合内置别名表的供应商可声明自己的取值键：
 * textKeys 为文本提取魔键；usage 与 toolCall 按类别给出键列表，
 * 条目支持点路径（如 prompt_tokens_details.cached_tokens、function.arguments）。
 */
export interface CustomProtocolAliases {
  textKeys?: string[]
  /** input/output/total/cached/reasoning。 */
  usage?: Record<string, string[]>
  /** id/name/arguments。 */
  toolCall?: Record<string, string[]>
}

/** 模型列表发现端点：listPath 定位数组，idPath/namePath 在元素内取标识与展示名。 */
export interface CustomProtocolModels {
  /** 默认 GET，仅 GET/POST。 */
  method?: string
  /** 必填，相对源 baseUrl。 */
  path: string
  headers?: Record<string, string>
  query?: Record<string, string>
  /** 缺省复用 request.auth。 */
  auth?: CustomProtocolAuth
  /** 必填，点路径到模型数组。 */
  listPath: string
  /** 元素内，默认 "id"。 */
  idPath?: string
  namePath?: string
}

/** 发现端点解析出的单个模型标识。 */
export interface CustomProtocolModelInfo {
  id: string
  name: string
}

/** 协议任务类型的内置约定；x- 前缀保留给外部扩展。 */
export const CUSTOM_PROTOCOL_TYPE_LLM = 'llm'
export const CUSTOM_PROTOCOL_TYPE_RERANKER = 'reranker'
export const CUSTOM_PROTOCOL_TYPE_EMBEDDING = 'embedding'

export interface CustomProtocolRequest {
  method?: string
  /** Go: path。 */
  path?: string
  /** 流式请求的路径覆盖；缺省同 path。 */
  pathStream?: string
  /**
   * 让模板上下文的 messages/tools（responses 另含 input/input_items）切换为
   * 对应线制形状——复用内置四协议的整形器。取值 openai-chat / anthropic /
   * gemini / responses。
   */
  shape?: string
  headers?: Record<string, string>
  query?: Record<string, string>
  contentType?: string
  auth?: CustomProtocolAuth
  /** legacy：原样模板文本。 */
  bodyTemplate?: string
  /** legacy：bodyTemplate 的旧名。 */
  submitBody?: string
  /** 字段引用注解树（新模型），编译为模板。 */
  body?: unknown
  omitIfEmpty?: string[]
}

export interface CustomProtocolAuth {
  mode?: string
  header?: string
  prefix?: string
  query?: string
}

export interface CustomProtocolResponse {
  /**
   * 返回体构造树：容器为普通 JSON 对象/数组，叶子为
   * {"field": ..., "value"?: ..., "transform"?} 映射标注或 {"value": ...} /
   * 裸标量结构占位。编译时从中提取字段映射。
   */
  body?: unknown
  idPath?: string
  modelPath?: string
  statusPath?: string
  textPath?: string
  /** textPath 指向对象数组时按元素过滤再提取文本；单条件或条件数组（AND）。 */
  textFilter?: CustomProtocolMatchSet
  reasoningPath?: string
  reasoningFilter?: CustomProtocolMatchSet
  toolCallsPath?: string
  usagePath?: string
  finishReasonPath?: string
  errorPath?: string
  /** legacy：目标 → 源路径表。 */
  mappings?: Record<string, string>
  fieldMappings?: CustomProtocolFieldMapping[]
  /** 字段级行映射（新模型）：path → Maheshvara 响应字段。 */
  fields?: CustomProtocolResponseFieldMapping[]
  /** 上游样例（离线校验用）。 */
  sample?: unknown
  stream?: CustomProtocolStreamMapping
}

export interface CustomProtocolFieldMapping {
  target: string
  source?: string
  value?: unknown
  default?: unknown
  transform?: string
  omitIfEmpty?: boolean
}

export interface CustomProtocolStreamMapping {
  payloadPath?: string
  /** delta | cumulative。 */
  mode?: string
  doneValues?: string[]
  /**
   * 类型化终止值：raw 为整串文本字面量（与 doneValues 同语义），
   * json 按解析后的载荷值做类型化匹配（如 {json:true} 命中 data: true）。
   */
  done?: CustomProtocolDoneValue[]
  /** 移除默认 [DONE]。 */
  doneValuesReplace?: boolean
  /** legacy：事件名白名单。 */
  events?: string[]
  /** JSON 载荷内事件名判别键（缺省 ["type","event"]）。 */
  eventKeys?: string[]
  /** 覆盖终止判定：缺省沿用 legacy（finishReasonPath 非空 / status=="completed"）。 */
  finishWhen?: CustomProtocolMatch
  statusWhen?: CustomProtocolMatch
  /** 按字段族（text/reasoning/arguments）覆盖全局 mode。 */
  modes?: CustomProtocolStreamModes
  frames?: CustomProtocolStreamFrame[]
  response?: CustomProtocolResponse
}

/** 按字段族的 delta/cumulative 覆盖；未声明的族沿用流级全局 mode。 */
export interface CustomProtocolStreamModes {
  text?: string
  reasoning?: string
  arguments?: string
}

/** 一个流终止值：raw（文本字面量）与 json（类型化值）二选一。 */
export interface CustomProtocolDoneValue {
  raw?: string
  json?: unknown
}

/**
 * 异构流的一类帧的映射规则：按事件名（SSE event 字段，缺省时取 JSON
 * type/event 字段）或谓词匹配，命中后以 frame.response 映射该帧。
 * terminal=true 时命中即判定流终态。frames 存在时优先于 legacy events
 * 白名单；未匹配任何帧的事件跳过。
 */
export interface CustomProtocolStreamFrame {
  /** SSE event 字段（或 eventKeys 判别键）匹配；与 match 同时给出时须同时成立。 */
  event?: string
  match?: CustomProtocolMatch
  payloadPath?: string
  /**
   * 分帧工具拼装：身份帧给 id/name，参数帧给增量参数片段；按 idPath 或
   * indexPath（关联身份帧）关联到同一工具调用。
   */
  tool?: CustomProtocolStreamTool
  response?: CustomProtocolResponse
  terminal?: boolean
}

/**
 * 帧级工具调用拼装规则：路径相对帧原始 JSON。argumentsMode 缺省 delta
 * （片段原样追加），cumulative 时片段为累计快照。
 */
export interface CustomProtocolStreamTool {
  /**
   * 指向工具对象数组（如 choices[0].delta.tool_calls）：设定时按元素遍历
   * （单帧多工具），以下路径相对每个元素；缺省时相对帧根，单工具。
   */
  path?: string
  idPath?: string
  indexPath?: string
  namePath?: string
  argumentsPath?: string
  argumentsMode?: string
}

/** 通用条件原语：点路径取值 + 任意类型的类型化比较。op 缺省 nonEmpty。 */
export interface CustomProtocolMatch {
  path: string
  op?: string
  value?: unknown
}

/** 条件集合：单条件对象或条件数组（数组语义为全部成立 AND；Go MatchSet 的 Unmarshal 兼容形态）。 */
export type CustomProtocolMatchSet = CustomProtocolMatch | CustomProtocolMatch[]

/** 一条字段级行映射：上游响应路径 → Maheshvara 响应字段，可选 transform。 */
export interface CustomProtocolResponseFieldMapping {
  path: string
  field: string
  transform?: string
}

/** 目录中的一个可映射字段。shape: string（引号内占位）/ native / scalar。 */
export interface MaheshvaraFieldSpec {
  name: string
  label: string
  shape: 'string' | 'native' | 'scalar'
  group: string
}

export interface CustomProtocolTypeSpec {
  value: string
  label: string
  hint: string
}

/** 协议设计器的字段目录与约束（校验与 UI 下拉共用，单一事实来源）。 */
export interface CustomProtocolSchema {
  requestFields: MaheshvaraFieldSpec[]
  responseFields: MaheshvaraFieldSpec[]
  transforms: string[]
  modes: string[]
  types: CustomProtocolTypeSpec[]
}

/** 渲染出的协议请求（传输执行由调用方/gateway 完成）。 */
export interface CustomProtocolRequestResult {
  method: string
  path: string
  headers: Record<string, string>
  query: Record<string, string>
  body?: string
  contentType: string
  auth: CustomProtocolAuth
}
