/**
 * Manifest 配置文件读取器
 * 
 * 负责从 JSON 文件读取生命体实例配置，
 * 进行核心字段校验，并返回 ManifestConfig 对象。
 */

import fs from 'fs/promises'
import type { ManifestConfig, LifeInstanceConfig } from './types.js'

/**
 * 从 JSON 文件加载 manifest 配置
 * 
 * @param path JSON 配置文件路径
 * @returns 解析后的 ManifestConfig
 * @throws 如果文件不存在、JSON 格式错误或核心字段校验失败
 */
export async function loadManifestFromFile(path: string): Promise<ManifestConfig> {
  const content = await fs.readFile(path, 'utf-8')
  return parseManifest(content)
}

/**
 * 从 JSON 字符串解析 manifest 配置
 * 
 * @param content JSON 字符串
 * @returns 解析后的 ManifestConfig
 * @throws 如果 JSON 格式错误或核心字段校验失败
 */
export function parseManifest(content: string): ManifestConfig {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (err) {
    throw new Error(`Manifest JSON parse error: ${(err as Error).message}`)
  }

  return validateManifest(raw)
}

/**
 * 校验并返回 ManifestConfig
 * 
 * 只校验核心字段：version / lifeInstances / 每项的 id / type
 * 不校验 extensions 内部结构（由各插件自行处理）
 */
export function validateManifest(raw: unknown): ManifestConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest validation error: the root value must be a JSON object, got ' + typeof raw)
  }

  const obj = raw as Record<string, unknown>

  if (!obj['version'] || typeof obj['version'] !== 'string') {
    throw new Error('Manifest validation error: missing or invalid required field "version" (expected: string)')
  }

  if (!Array.isArray(obj['lifeInstances'])) {
    throw new Error('Manifest validation error: missing or invalid required field "lifeInstances" (expected: array)')
  }

  const lifeInstances: LifeInstanceConfig[] = []
  const seenIds = new Set<string>()

  for (const item of obj['lifeInstances'] as unknown[]) {
    if (!item || typeof item !== 'object') {
      throw new Error('Manifest validation error: each item in "lifeInstances" must be an object')
    }

    const instance = item as Record<string, unknown>

    if (!instance['id'] || typeof instance['id'] !== 'string') {
      throw new Error('Manifest validation error: each life instance must have a non-empty string field "id"')
    }

    if (seenIds.has(instance['id'])) {
      throw new Error(`Manifest validation error: duplicate life instance id "${instance['id']}"`)
    }
    seenIds.add(instance['id'])

    if (!instance['type'] || typeof instance['type'] !== 'string') {
      throw new Error(`Manifest validation error: life instance "${instance['id']}" must have a non-empty string field "type"`)
    }

    lifeInstances.push({
      id: instance['id'],
      type: instance['type'],
      enabled: instance['enabled'] !== false, // 默认 true
      meta: typeof instance['meta'] === 'object' && instance['meta'] !== null
        ? instance['meta'] as Record<string, unknown>
        : undefined,
      extensions: typeof instance['extensions'] === 'object' && instance['extensions'] !== null
        ? instance['extensions'] as Record<string, Record<string, unknown>>
        : undefined,
    })
  }

  return {
    version: obj['version'] as string,
    lifeInstances,
  }
}
