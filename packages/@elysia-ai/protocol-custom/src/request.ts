/**
 * 请求渲染层：MaheshvaraRequest → 协议请求（method/path/headers/query/body/
 * contentType/auth），含线制 shape 切换与模型列表发现。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol.go` 的
 * RenderCustomProtocolRequest 族与 applyCustomProtocolShape 逐行为对齐。
 * HTTP 执行（URL 拼接、鉴权注入、SSE 拉流）归传输层（model-gateway）。
 */

import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import {
  applyClaudeDisableParallelToolUse,
  maheshvaraMessagesToClaude,
  maheshvaraToolChoiceToClaude,
  maheshvaraToolsToClaude,
} from '@elysia-ai/protocol-anthropic'
import { maheshvaraMessagesToGemini, maheshvaraToolsToGemini } from '@elysia-ai/protocol-gemini'
import { maheshvaraMessagesToOpenAI, maheshvaraToolsToOpenAI } from '@elysia-ai/protocol-openai'
import { maheshvaraInputToResponses, maheshvaraToolsToResponses } from '@elysia-ai/protocol-responses'
import type { CustomProtocolConfig, CustomProtocolModelInfo, CustomProtocolRequestResult } from './types.js'
import { effectiveCustomProtocolBodyTemplate, validateCustomProtocol } from './validate.js'
import { maheshvaraTemplateContext, renderCustomString, renderCustomTemplate } from './template.js'
import { customLookupPath, customValueString } from './paths.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把模板上下文中的 messages/tools（responses 另含 input/input_items）替换为
 * 对应线制形状，复用内置四协议的整形器——自定义协议作者不再需要手写
 * 消息/工具的字段级转换。
 */
export function applyCustomProtocolShape(
  shape: string,
  req: MaheshvaraRequest,
  context: Record<string, unknown>,
): void {
  if (shape === '') return
  const root = isPlainObject(context['maheshvara']) ? context['maheshvara'] : undefined
  if (!root) return
  const setTools = (tools: Array<Record<string, unknown>> | undefined): void => {
    if (tools && tools.length > 0) root['tools'] = tools
  }
  switch (shape) {
    case 'openai-chat': {
      root['messages'] = maheshvaraMessagesToOpenAI(req)
      setTools(maheshvaraToolsToOpenAI(req.tools ?? []))
      return
    }
    case 'anthropic': {
      root['messages'] = maheshvaraMessagesToClaude(req)
      // tool_choice 同步转为目标形状（公共形状 "required" 等 Claude 不识别）。
      const converted = applyClaudeDisableParallelToolUse(
        req.tool_choice !== undefined && req.tool_choice !== null ? maheshvaraToolChoiceToClaude(req.tool_choice) : undefined,
        req.parallel_tool_calls,
      )
      if (converted !== undefined && converted !== null) {
        root['tool_choice'] = converted
      }
      setTools(maheshvaraToolsToClaude(req.tools ?? []))
      return
    }
    case 'gemini': {
      root['messages'] = maheshvaraMessagesToGemini(req)
      setTools(maheshvaraToolsToGemini(req.tools ?? []))
      return
    }
    case 'responses': {
      const input = maheshvaraInputToResponses(req)
      root['input'] = input
      root['input_items'] = input
      root['messages'] = input
      const tools = maheshvaraToolsToResponses(req.tools ?? [])
      if (tools.length > 0) root['tools'] = tools
      return
    }
  }
  throw new Error(`${JSON.stringify(shape)} is unsupported`)
}

function renderCustomProtocolRequestWithBody(
  req: MaheshvaraRequest,
  config: CustomProtocolConfig,
  template: string,
  omitIfEmpty: string[],
  omitRules: import('./template.js').CustomOmitRule[],
): CustomProtocolRequestResult {
  const ctx = maheshvaraTemplateContext(req)
  const shape = (config.request.shape ?? '').trim().toLowerCase()
  try {
    applyCustomProtocolShape(shape, req, ctx)
  } catch (error) {
    throw new Error(`custom protocol ${JSON.stringify(config.id)} request.shape: ${(error as Error).message}`)
  }
  let bodyText: string | undefined
  if (template !== '') {
    const rendered = renderCustomTemplate(template, ctx, omitIfEmpty, omitRules)
    bodyText = JSON.stringify(rendered)
  }
  // 流式请求切换到 pathStream（Gemini :generateContent vs
  // :streamGenerateContent?alt=sse 这类按流切换动词的端点）。
  let pathTemplate = config.request.path ?? ''
  if (req.stream && (config.request.pathStream ?? '').trim() !== '') {
    pathTemplate = config.request.pathStream!
  }
  const contentType = (config.request.contentType ?? '').trim() !== ''
    ? config.request.contentType!.trim()
    : 'application/json'
  let method = (config.request.method ?? '').trim().toUpperCase()
  if (method === '') method = 'POST'
  const path = renderCustomString(pathTemplate, ctx)
  if (path.includes('\r') || path.includes('\n')) {
    throw new Error(`custom protocol ${JSON.stringify(config.id)} rendered path contains a line break`)
  }
  const headers: Record<string, string> = { 'Content-Type': contentType }
  for (const [key, value] of Object.entries(config.request.headers ?? {})) {
    const rendered = renderCustomString(value, ctx)
    if (rendered.includes('\r') || rendered.includes('\n')) {
      throw new Error(`custom protocol ${JSON.stringify(config.id)} rendered header ${JSON.stringify(key)} contains a line break`)
    }
    headers[key] = rendered
  }
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.request.query ?? {})) {
    query[key] = renderCustomString(value, ctx)
  }
  return {
    method,
    path,
    headers,
    query,
    body: bodyText,
    contentType,
    auth: config.request.auth ?? {},
  }
}

/**
 * 渲染外部传入的协议配置（预览/测试等非注册路径，先整体校验）。
 * 注册表内的协议走 renderRegisteredCustomProtocolRequest 免校验。
 */
export function renderCustomProtocolRequest(req: MaheshvaraRequest, config: CustomProtocolConfig): CustomProtocolRequestResult {
  validateCustomProtocol(config)
  return renderCustomProtocolRequestUnchecked(req, config)
}

/** 渲染已校验配置的请求（注册表热路径 / 内部复用）。 */
export function renderCustomProtocolRequestUnchecked(req: MaheshvaraRequest, config: CustomProtocolConfig): CustomProtocolRequestResult {
  const { template, omitIfEmpty, omitRules } = effectiveCustomProtocolBodyTemplate(config.request)
  return renderCustomProtocolRequestWithBody(req, config, template, omitIfEmpty, omitRules)
}

/**
 * 构造模型列表发现请求。发现端点没有请求上下文可渲染，占位符按空值处理；
 * 鉴权缺省继承 request.auth，可被 models.auth 覆盖。
 */
export function renderCustomProtocolModelsRequest(config: CustomProtocolConfig): CustomProtocolRequestResult {
  const models = config.models
  if (!models) {
    throw new Error(`custom protocol ${JSON.stringify(config.id)} does not define model discovery`)
  }
  let method = (models.method ?? '').trim().toUpperCase()
  if (method === '') method = 'GET'
  const auth = models.auth ?? config.request.auth ?? {}
  const empty: Record<string, unknown> = { maheshvara: {}, request: {} }
  const path = renderCustomString(models.path, empty)
  if (path.includes('\r') || path.includes('\n')) {
    throw new Error(`custom protocol ${JSON.stringify(config.id)} rendered models path contains a line break`)
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(models.headers ?? {})) {
    headers[key] = renderCustomString(value, empty)
  }
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(models.query ?? {})) {
    query[key] = renderCustomString(value, empty)
  }
  return { method, path, headers, query, contentType: 'application/json', auth }
}

/**
 * 解析模型列表响应：listPath 定位数组，idPath/namePath 在每个元素内取
 * 标识与展示名（缺省 id）。无 id 的元素跳过。
 */
export function parseCustomProtocolModels(body: unknown, config: CustomProtocolConfig): CustomProtocolModelInfo[] {
  const models = config.models
  if (!models) {
    throw new Error(`custom protocol ${JSON.stringify(config.id)} does not define model discovery`)
  }
  const root = typeof body === 'string' ? JSON.parse(body) : body
  const { value: list, found } = customLookupPath(root, models.listPath)
  if (!found) {
    throw new Error(`models list path ${JSON.stringify(models.listPath)} not found in response`)
  }
  if (!Array.isArray(list)) {
    throw new Error(`models list path ${JSON.stringify(models.listPath)} does not point to an array`)
  }
  const idPath = (models.idPath ?? '').trim() !== '' ? models.idPath!.trim() : 'id'
  const namePath = (models.namePath ?? '').trim()
  const result: CustomProtocolModelInfo[] = []
  for (const item of list) {
    const id = customValueString(customLookupPath(item, idPath).value)
    if (id === '') continue
    const info: CustomProtocolModelInfo = { id, name: id }
    if (namePath !== '') {
      const name = customValueString(customLookupPath(item, namePath).value)
      if (name !== '') info.name = name
    }
    result.push(info)
  }
  return result
}
