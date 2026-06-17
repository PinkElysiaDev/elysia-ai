/**
 * Manifest 配置类型定义
 * 
 * 生命体实例配置文件采用 JSON 格式，通过 manifestPath 指定路径。
 * 核心字段固定，扩展配置通过 extensions 命名空间隔离。
 */

/**
 * 生命体实例配置
 * 
 * 核心字段：id / type / enabled / meta
 * 扩展字段：extensions[configNamespace]
 */
export interface LifeInstanceConfig {
  /**
   * 生命体唯一标识
   */
  id: string

  /**
   * 生命体类型（用于插件识别和能力加载）
   */
  type: string

  /**
   * 是否启用（默认 true）
   */
  enabled?: boolean

  /**
   * 通用元信息，供 runtime 和 observatory 使用
   */
  meta?: Record<string, unknown>

  /**
   * 插件扩展配置区
   * 按插件 configNamespace 隔离，避免字段冲突
   * 例：extensions["@elysia-ai/persona"] = { traits: ["friendly"] }
   */
  extensions?: Record<string, Record<string, unknown>>
}

/**
 * Manifest 配置文件格式
 */
export interface ManifestConfig {
  /**
   * 配置格式版本
   */
  version: string

  /**
   * 生命体实例列表
   */
  lifeInstances: LifeInstanceConfig[]
}
