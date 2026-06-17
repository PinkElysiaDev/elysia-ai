import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readPackage(path: string) {
  return JSON.parse(readFileSync(resolve(__dirname, '..', path, 'package.json'), 'utf8'))
}

const pluginPackages = [
  ['packages/elysia-ai-runtime', 'koishi-plugin-elysia-ai-runtime', 'elysia.runtime'],
  ['packages/elysia-ai-body', 'koishi-plugin-elysia-ai-body', 'elysia.body'],
  ['packages/elysia-ai-behavior', 'koishi-plugin-elysia-ai-behavior', 'elysia.behavior'],
  ['packages/elysia-ai-bond', 'koishi-plugin-elysia-ai-bond', 'elysia.bond'],
  ['packages/elysia-ai-brain', 'koishi-plugin-elysia-ai-brain', 'elysia.brain'],
  ['packages/elysia-ai-cognition', 'koishi-plugin-elysia-ai-cognition', 'elysia.cognition'],
  ['packages/elysia-ai-dialogue', 'koishi-plugin-elysia-ai-dialogue', 'elysia.dialogue'],
  ['packages/elysia-ai-homeostasis', 'koishi-plugin-elysia-ai-homeostasis', 'elysia.homeostasis'],
  ['packages/elysia-ai-memory', 'koishi-plugin-elysia-ai-memory', 'elysia.memory'],
  ['packages/elysia-ai-model-gateway', 'koishi-plugin-elysia-ai-model-gateway', 'elysia.modelGateway'],
  ['packages/elysia-ai-observatory', 'koishi-plugin-elysia-ai-observatory', 'elysia.observatory'],
  ['packages/elysia-ai-perception', 'koishi-plugin-elysia-ai-perception', 'elysia.perception'],
  ['packages/elysia-ai-persona', 'koishi-plugin-elysia-ai-persona', 'elysia.persona'],
] as const

const internalPackages = [
  ['packages/@elysia-ai/core', '@elysia-ai/core'],
  ['packages/@elysia-ai/shared', '@elysia-ai/shared'],
  ['packages/@elysia-ai/behavior', '@elysia-ai/behavior'],
  ['packages/@elysia-ai/bond', '@elysia-ai/bond'],
  ['packages/@elysia-ai/brain', '@elysia-ai/brain'],
  ['packages/@elysia-ai/cognition', '@elysia-ai/cognition'],
  ['packages/@elysia-ai/dialogue', '@elysia-ai/dialogue'],
  ['packages/@elysia-ai/homeostasis', '@elysia-ai/homeostasis'],
  ['packages/@elysia-ai/memory', '@elysia-ai/memory'],
  ['packages/@elysia-ai/model-gateway', '@elysia-ai/model-gateway'],
  ['packages/@elysia-ai/observatory', '@elysia-ai/observatory'],
  ['packages/@elysia-ai/perception', '@elysia-ai/perception'],
  ['packages/@elysia-ai/persona', '@elysia-ai/persona'],
] as const

describe('Koishi package metadata', () => {
  it.each(pluginPackages)('%s declares top-level Koishi plugin metadata', (path, name, serviceName) => {
    const pkg = readPackage(path)

    expect(pkg.name).toBe(name)
    expect(pkg.name).toMatch(/^koishi-plugin-elysia-ai-/)
    expect(pkg.main).toBeTruthy()
    expect(pkg.types ?? pkg.typings).toBe('lib/index.d.ts')
    expect(pkg.exports?.['.']).toBeTruthy()
    expect(pkg.exports?.['.']?.types).toBe('./lib/index.d.ts')
    expect(pkg.exports?.['./package.json']).toBe('./package.json')
    expect(pkg.files).toContain('lib')
    expect(pkg.koishi?.description).toBeTruthy()
    expect(pkg.koishi?.service?.implements).toContain(serviceName)
    expect(pkg.peerDependencies?.koishi).toBeTruthy()
  })

  it.each(internalPackages)('%s remains an internal @elysia-ai package', (path, name) => {
    const pkg = readPackage(path)

    expect(pkg.name).toBe(name)
    expect(pkg.name).toMatch(/^@elysia-ai\//)
    expect(pkg.name).not.toContain('koishi-plugin')
    expect(pkg.koishi).toBeUndefined()
    expect(pkg.exports?.['.']).toBeTruthy()
    expect(pkg.exports?.['./package.json']).toBe('./package.json')
  })
})
