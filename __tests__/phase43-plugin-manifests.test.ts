import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ELYSIA_SERVICES } from '@elysia-ai/core'

/**
 * Phase 43（框架化 P1）验收：13 个官方插件壳全部声明 kernel manifest。
 * 静态断言（与 phase39 插件边界测试同风格）：每个壳源码包含
 * 工厂式 `manifest: {` 或手写式 `manifests?.register({`，
 * 且 provides 覆盖其 koishi.service.implements 声明的服务。
 */

const pluginsRoot = join(__dirname, '..', 'packages')

const PLUGINS: Array<{ dir: string, service: string }> = [
  { dir: 'elysia-ai-runtime', service: 'elysia.runtime' },
  { dir: 'elysia-ai-body', service: 'elysia.body' },
  { dir: 'elysia-ai-perception', service: 'elysia.perception' },
  { dir: 'elysia-ai-cognition', service: 'elysia.cognition' },
  { dir: 'elysia-ai-behavior', service: 'elysia.behavior' },
  { dir: 'elysia-ai-dialogue', service: 'elysia.dialogue' },
  { dir: 'elysia-ai-brain', service: 'elysia.brain' },
  { dir: 'elysia-ai-model-gateway', service: 'elysia.modelGateway' },
  { dir: 'elysia-ai-memory', service: 'elysia.memory' },
  { dir: 'elysia-ai-bond', service: 'elysia.bond' },
  { dir: 'elysia-ai-homeostasis', service: 'elysia.homeostasis' },
  { dir: 'elysia-ai-persona', service: 'elysia.persona' },
  { dir: 'elysia-ai-observatory', service: 'elysia.observatory' },
]

describe('Phase 43 插件 manifest 声明完整性', () => {
  it.each(PLUGINS)('$dir 声明 kernel manifest 且 provides 自身服务', ({ dir, service }) => {
    const source = readFileSync(join(pluginsRoot, dir, 'src', 'index.ts'), 'utf8')
    const factoryStyle = /manifest: \{/.test(source)
    const manualStyle = /manifests\?\.register\(\{/.test(source)
    expect(factoryStyle || manualStyle, `${dir} 应包含 manifest 声明`).toBe(true)
    expect(source, `${dir} 应 provides ${service}`).toContain(service)
  })

  it('13 个壳覆盖 ELYSIA_SERVICES 全部正式服务（persistence 由 runtime 提供）', () => {
    const covered = new Set(PLUGINS.map((plugin) => plugin.service))
    for (const { formalName } of ELYSIA_SERVICES) {
      if (formalName === 'elysia.persistence') {
        expect(covered.has('elysia.runtime')).toBe(true)
        continue
      }
      expect(covered.has(formalName), `ELYSIA_SERVICES 中的 ${formalName} 应有对应插件壳`).toBe(true)
    }
  })

  it('全部 manifest 引用的服务存在于 ELYSIA_SERVICES（validate 不产生 error 的前提）', () => {
    const known = new Set(ELYSIA_SERVICES.map((service) => service.formalName))
    for (const { dir } of PLUGINS) {
      const source = readFileSync(join(pluginsRoot, dir, 'src', 'index.ts'), 'utf8')
      for (const match of source.matchAll(/provides: \[([^\]]*)\]/g)) {
        for (const service of match[1].split(',').map((item) => item.trim().replace(/['"`]/g, '')).filter(Boolean)) {
          expect(known.has(service), `${dir} provides 未知服务 ${service}`).toBe(true)
        }
      }
    }
  })
})
