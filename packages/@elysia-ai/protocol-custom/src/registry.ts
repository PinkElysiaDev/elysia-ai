/**
 * 协议注册表：校验 + 编译一次完成，热路径直接取用。
 * 与 Elysia-Api（Go）`backend/relay/custom_protocol.go` 的
 * RegisterCustomProtocol / ReplaceCustomProtocols / GetCustomProtocol 对齐。
 */

import type { CustomProtocolConfig } from './types.js'
import { normalizeCustomProtocol, validateCustomProtocol, effectiveCustomProtocolBodyTemplate } from './validate.js'
import { renderCustomProtocolRequestUnchecked } from './request.js'
import type { CustomProtocolRequestResult } from './types.js'
import type { MaheshvaraRequest } from '@elysia-ai/maheshvara'
import { CustomProtocolStreamDecoder } from './stream.js'
import { customProtocolResponseFromRoot, resolveCustomMapping } from './response.js'

interface CompiledCustomProtocol {
  config: CustomProtocolConfig
  template: string
  omitIfEmpty: string[]
  omitRules: import('./template.js').CustomOmitRule[]
}

const registry = new Map<string, CompiledCustomProtocol>()

function compileCustomProtocol(config: CustomProtocolConfig): CompiledCustomProtocol {
  const { template, omitIfEmpty, omitRules } = effectiveCustomProtocolBodyTemplate(config.request)
  return { config, template, omitIfEmpty: [...omitIfEmpty], omitRules }
}

function registryKey(id: string): string {
  return id.trim().toLowerCase()
}

/** 校验并原子安装一个自定义协议。 */
export function registerCustomProtocol(config: CustomProtocolConfig): void {
  validateCustomProtocol(config)
  const normalized = normalizeCustomProtocol(config)
  registry.set(registryKey(normalized.id), compileCustomProtocol(normalized))
}

/** 校验整套配置并原子换入；失败的 reload 不影响已注册协议。 */
export function replaceCustomProtocols(configs: CustomProtocolConfig[]): void {
  const next = new Map<string, CompiledCustomProtocol>()
  for (const config of configs) {
    validateCustomProtocol(config)
    const key = registryKey(config.id)
    if (next.has(key)) {
      throw new Error(`custom protocol ${JSON.stringify(config.id)} is duplicated`)
    }
    next.set(key, compileCustomProtocol(normalizeCustomProtocol(config)))
  }
  registry.clear()
  for (const [key, value] of next) registry.set(key, value)
}

export function getCustomProtocol(id: string): CustomProtocolConfig | undefined {
  return registry.get(registryKey(id))?.config
}

export function listCustomProtocols(): CustomProtocolConfig[] {
  return [...registry.values()].map((compiled) => compiled.config)
}

export function hasCustomProtocol(id: string): boolean {
  return registry.has(registryKey(id))
}

export function clearCustomProtocols(): void {
  registry.clear()
}

/** 渲染注册表内协议的请求（入库时已整体校验并预编译，热路径免校验）。 */
export function renderRegisteredCustomProtocolRequest(req: MaheshvaraRequest, id: string): CustomProtocolRequestResult {
  const compiled = registry.get(registryKey(id))
  if (!compiled) {
    throw new Error(`custom protocol ${JSON.stringify(id)} is not registered`)
  }
  return renderCustomProtocolRequestUnchecked(req, compiled.config)
}

/** 为注册表内协议构造流解码器（入库时已整体校验）。 */
export function createRegisteredStreamDecoder(id: string): CustomProtocolStreamDecoder {
  const compiled = registry.get(registryKey(id))
  if (!compiled) {
    throw new Error(`custom protocol ${JSON.stringify(id)} is not registered`)
  }
  return new CustomProtocolStreamDecoder(compiled.config)
}

/** 映射注册表内协议的上游响应（非流式）。 */
export function customProtocolResponseToMaheshvara(body: unknown, id: string) {
  const compiled = registry.get(registryKey(id))
  if (!compiled) {
    throw new Error(`custom protocol ${JSON.stringify(id)} is not registered`)
  }
  const root = typeof body === 'string' ? JSON.parse(body) : body
  const resolved = resolveCustomMapping(compiled.config, false)
  return customProtocolResponseFromRoot(root, resolved, compiled.config.aliases, compiled.config.id, false)
}
