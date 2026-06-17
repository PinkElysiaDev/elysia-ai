import { describe, expect, it } from 'vitest'

const pluginEntries = [
  ['runtime', '../packages/elysia-ai-runtime/lib/index.mjs'],
  ['body', '../packages/elysia-ai-body/lib/index.mjs'],
  ['behavior', '../packages/elysia-ai-behavior/lib/index.mjs'],
  ['brain', '../packages/elysia-ai-brain/lib/index.mjs'],
  ['cognition', '../packages/elysia-ai-cognition/lib/index.mjs'],
  ['dialogue', '../packages/elysia-ai-dialogue/lib/index.mjs'],
  ['homeostasis', '../packages/elysia-ai-homeostasis/lib/index.mjs'],
  ['memory', '../packages/elysia-ai-memory/lib/index.mjs'],
  ['bond', '../packages/elysia-ai-bond/lib/index.mjs'],
  ['model-gateway', '../packages/elysia-ai-model-gateway/lib/index.mjs'],
  ['observatory', '../packages/elysia-ai-observatory/lib/index.mjs'],
  ['perception', '../packages/elysia-ai-perception/lib/index.mjs'],
  ['persona', '../packages/elysia-ai-persona/lib/index.mjs'],
] as const

const internalEntries = [
  ['behavior', '../packages/@elysia-ai/behavior/lib/index.js', 'createBehaviorPluginRuntime'],
  ['brain', '../packages/@elysia-ai/brain/lib/index.js', 'createBrainPluginRuntime'],
  ['cognition', '../packages/@elysia-ai/cognition/lib/index.js', 'createCognitionPluginRuntime'],
  ['dialogue', '../packages/@elysia-ai/dialogue/lib/index.js', 'createDialoguePluginRuntime'],
  ['homeostasis', '../packages/@elysia-ai/homeostasis/lib/index.js', 'createHomeostasisPluginRuntime'],
  ['memory', '../packages/@elysia-ai/memory/lib/index.js', 'createMemoryPluginRuntime'],
  ['bond', '../packages/@elysia-ai/bond/lib/index.js', 'createBondPluginRuntime'],
  ['model-gateway', '../packages/@elysia-ai/model-gateway/lib/index.js', 'createModelGatewayPluginRuntime'],
  ['observatory', '../packages/@elysia-ai/observatory/lib/index.js', 'createObservatoryPluginRuntime'],
  ['perception', '../packages/@elysia-ai/perception/lib/index.js', 'createPerceptionPluginRuntime'],
  ['persona', '../packages/@elysia-ai/persona/lib/index.js', 'createPersonaPluginRuntime'],
] as const

describe('Phase 37 package exports', () => {
  it.each(pluginEntries)('%s exposes name, Config and apply from built package entry', async (_label, entry) => {
    const plugin = await import(entry)

    expect(typeof plugin.name).toBe('string')
    expect(plugin.name.length).toBeGreaterThan(0)
    expect(plugin.Config).toBeTruthy()
    expect(typeof plugin.apply).toBe('function')
  })


  it.each(internalEntries)('%s exposes an internal factory without official Koishi plugin entry', async (_label, entry, factoryName) => {
    const internalPackage = await import(entry)

    expect(typeof internalPackage[factoryName]).toBe('function')
    expect(internalPackage.apply).toBeUndefined()
  })
})
