/**
 * maheshvara 内容类型 / 输入项类型 / 输出项类型 / 流事件类型常量。
 * 与 Elysia-Api（Go）backend/relay/maheshvara_types.go 顶部的常量块逐一对齐
 * （relay/constants.go 只含 SSE 缓冲上限等网关常量，非 maheshvara 常量）。
 */

export const SIGNATURE_PROVIDER_ANTHROPIC = 'anthropic'
export const SIGNATURE_PROVIDER_GEMINI = 'gemini'
export const SIGNATURE_PROVIDER_OPENAI = 'openai'
export const SIGNATURE_PROVIDER_MAHESHVARA = 'maheshvara'

/**
 * 线制格式标识（Go FormatType）。
 * 基础值见 converter.go（openai/deepseek/gemini/claude/unknown），
 * 流式别名见 maheshvara_types.go 顶部（openai_chat / openai_responses）。
 * 错误协议层（errors.ts）以它选择渲染/解析分支。
 */
export const FORMAT_OPENAI = 'openai'
export const FORMAT_DEEPSEEK = 'deepseek'
export const FORMAT_GEMINI = 'gemini'
export const FORMAT_CLAUDE = 'claude'
export const FORMAT_UNKNOWN = 'unknown'
/** Chat Completions 流式别名（Go FormatChatCompletions = FormatOpenAIChat）。 */
export const FORMAT_OPENAI_CHAT = 'openai_chat'
/** Responses 流式别名。 */
export const FORMAT_RESPONSES = 'openai_responses'

export const CONTENT_TEXT = 'text'
export const CONTENT_IMAGE = 'image'
export const CONTENT_AUDIO = 'audio'
export const CONTENT_VIDEO = 'video'
export const CONTENT_FILE = 'file'
export const CONTENT_DOCUMENT = 'document'
export const CONTENT_TOOL_OUTPUT = 'tool_output'
export const CONTENT_TOOL_CALL = 'tool_call'
export const CONTENT_REASONING = 'reasoning'
export const CONTENT_REFUSAL = 'refusal'

export const INPUT_MESSAGE = 'message'
export const INPUT_FUNCTION_CALL_OUTPUT = 'function_call_output'
export const INPUT_ITEM_REFERENCE = 'item_reference'

export const TOOL_FUNCTION = 'function'
export const TOOL_WEB_SEARCH_PREVIEW = 'web_search_preview'
export const TOOL_FILE_SEARCH = 'file_search'
export const TOOL_COMPUTER_USE_PREVIEW = 'computer_use_preview'
export const TOOL_CODE_INTERPRETER = 'code_interpreter'
export const TOOL_IMAGE_GENERATION = 'image_generation'

export const OUTPUT_MESSAGE = 'message'
export const OUTPUT_FUNCTION_CALL = 'function_call'
export const OUTPUT_REASONING = 'reasoning'
export const OUTPUT_WEB_SEARCH_CALL = 'web_search_call'
export const OUTPUT_FILE_SEARCH_CALL = 'file_search_call'
export const OUTPUT_IMAGE_GENERATION_CALL = 'image_generation_call'

export const EVENT_RESPONSE_CREATED = 'response.created'
export const EVENT_RESPONSE_IN_PROGRESS = 'response.in_progress'
export const EVENT_OUTPUT_ITEM_ADDED = 'response.output_item.added'
export const EVENT_CONTENT_PART_ADDED = 'response.content_part.added'
export const EVENT_CONTENT_PART_DONE = 'response.content_part.done'
export const EVENT_TEXT_DELTA = 'response.output_text.delta'
export const EVENT_TEXT_DONE = 'response.output_text.done'
export const EVENT_REASONING_DELTA = 'response.reasoning.delta'
export const EVENT_REASONING_DONE = 'response.reasoning.done'
export const EVENT_REASONING_SUMMARY_DELTA = 'response.reasoning_summary_text.delta'
export const EVENT_REASONING_SUMMARY_DONE = 'response.reasoning_summary_text.done'
export const EVENT_REASONING_SIGNATURE_DELTA = 'response.reasoning_signature.delta'
export const EVENT_REFUSAL_DELTA = 'response.refusal.delta'
export const EVENT_REFUSAL_DONE = 'response.refusal.done'
export const EVENT_FUNCTION_CALL_ADDED = 'response.function_call.added'
export const EVENT_FUNCTION_CALL_ARGUMENTS_DELTA = 'response.function_call_arguments.delta'
export const EVENT_FUNCTION_CALL_ARGUMENTS_DONE = 'response.function_call_arguments.done'
export const EVENT_OUTPUT_ITEM_DONE = 'response.output_item.done'
export const EVENT_USAGE_DELTA = 'response.usage.delta'
export const EVENT_RESPONSE_COMPLETED = 'response.completed'
export const EVENT_RESPONSE_FAILED = 'response.failed'

/** 承载引用/出处标注增量（Claude citations_delta / 通用标注通道）。 */
export const EVENT_ANNOTATION_DELTA = 'annotation.delta'

/** Gemini groundingMetadata 在 text 事件 annotations 里的包装键。 */
export const ANNOTATION_GEMINI_GROUNDING = 'gemini_grounding_metadata'
