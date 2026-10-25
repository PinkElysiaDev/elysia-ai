/**
 * 插件 manifest 注册表与兼容性校验。
 *
 * 解决 Koishi "装了不兼容的插件只会运行时炸"的短板：
 * 插件在装配时向注册表声明自身（名字/版本/依赖/服务/阶段/配置命名空间），
 * 宿主在启动时校验：依赖存在性、frameworkApiVersion 兼容、
 * 命名空间冲突、引用了未知服务/阶段。第一期全部为告警不阻断。
 */

import { satisfiesRange } from './semver.js'

/** kernel 契约版本：随 kernel 破坏性变更递增。 */
export const KERNEL_API_VERSION = '0.1.0'

/** kernel 自身可接受的兼容范围（第三方 manifest.frameworkApiVersion 落在此区间即可）。 */
export const KERNEL_API_RANGE = '^0.1.0'

export interface KernelPluginManifest {
  /** 插件唯一名。官方 @elysia-ai/<name>；第三方建议 elysia-plugin-<name> 或 scoped。 */
  name: string
  /** semver 版本。 */
  version: string
  /** 兼容的 kernel/framework API 版本区间；缺省视为兼容。 */
  frameworkApiVersion?: string
  /** 依赖的其他插件 name 列表。 */
  dependencies?: string[]
  /** 提供与消费的服务 id（如 'elysia.perception'）。 */
  services?: { provides?: string[], consumes?: string[] }
  /** 挂载与提供的管线阶段名。 */
  stages?: { hooks?: string[], provides?: string[] }
  /** manifest.json extensions 配置命名空间。 */
  configNamespace?: string
  /** 能力标签。 */
  capabilities?: string[]
}

export type ManifestIssueSeverity = 'warn' | 'error'

export interface ManifestIssue {
  plugin: string
  severity: ManifestIssueSeverity
  code: string
  message: string
}

export interface ManifestRegistryHostInfo {
  /** 宿主已知的全部服务 id。 */
  knownServices?: string[]
  /** 宿主已知的全部阶段名。 */
  knownStages?: string[]
}

export class PluginManifestRegistry {
  private readonly manifests = new Map<string, KernelPluginManifest>()

  /** 注册/覆盖同名插件 manifest；返回注销函数。 */
  register(manifest: KernelPluginManifest): () => void {
    this.manifests.set(manifest.name, manifest)
    return () => {
      this.manifests.delete(manifest.name)
    }
  }

  get(name: string): KernelPluginManifest | undefined {
    return this.manifests.get(name)
  }

  getAll(): KernelPluginManifest[] {
    return [...this.manifests.values()]
  }

  /**
   * 全量校验。返回问题列表（不抛错、不阻断——第一期治理为告警式）。
   * error 级问题留给宿主决定是否升级为阻断。
   */
  validate(host: ManifestRegistryHostInfo = {}): ManifestIssue[] {
    const issues: ManifestIssue[] = []
    const names = new Set(this.manifests.keys())
    const namespaces = new Map<string, string>()
    const providedServices = new Set<string>()
    for (const manifest of this.manifests.values()) {
      for (const service of manifest.services?.provides ?? []) {
        providedServices.add(service)
      }
    }

    for (const manifest of this.manifests.values()) {
      // 依赖存在性。
      for (const dependency of manifest.dependencies ?? []) {
        if (!names.has(dependency)) {
          issues.push({
            plugin: manifest.name,
            severity: 'error',
            code: 'missing-dependency',
            message: `dependency "${dependency}" is not registered`,
          })
        }
      }
      // 框架版本兼容。
      if (manifest.frameworkApiVersion && !satisfiesRange(KERNEL_API_VERSION, manifest.frameworkApiVersion)) {
        issues.push({
          plugin: manifest.name,
          severity: 'warn',
          code: 'framework-version-mismatch',
          message: `declared frameworkApiVersion "${manifest.frameworkApiVersion}" does not cover kernel ${KERNEL_API_VERSION}`,
        })
      }
      // 服务引用存在性：消费的服务要么由其他插件提供，要么是宿主已知服务。
      const knownServices = new Set([...(host.knownServices ?? []), ...providedServices])
      for (const service of manifest.services?.consumes ?? []) {
        if (knownServices.size > 0 && !knownServices.has(service)) {
          issues.push({
            plugin: manifest.name,
            severity: 'warn',
            code: 'unknown-service',
            message: `consumes unknown service "${service}"`,
          })
        }
      }
      // 阶段引用存在性。
      const knownStages = new Set(host.knownStages ?? [])
      for (const stage of manifest.stages?.hooks ?? []) {
        if (knownStages.size > 0 && !knownStages.has(stage)) {
          issues.push({
            plugin: manifest.name,
            severity: 'warn',
            code: 'unknown-stage',
            message: `hooks unknown stage "${stage}" (implicit stage; declare it if intentional)`,
          })
        }
      }
      // 配置命名空间冲突。
      if (manifest.configNamespace) {
        const existing = namespaces.get(manifest.configNamespace)
        if (existing && existing !== manifest.name) {
          issues.push({
            plugin: manifest.name,
            severity: 'error',
            code: 'namespace-conflict',
            message: `configNamespace "${manifest.configNamespace}" already claimed by "${existing}"`,
          })
        } else {
          namespaces.set(manifest.configNamespace, manifest.name)
        }
      }
    }
    return issues
  }

  /** 按 configNamespace 查找（用于 manifest.json extensions 键对齐校验）。 */
  findByNamespace(namespace: string): KernelPluginManifest | undefined {
    return this.getAll().find((manifest) => manifest.configNamespace === namespace)
  }
}
