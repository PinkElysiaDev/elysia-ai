import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import * as internalBehavior from '../packages/@elysia-ai/behavior/src/index.js'
import * as internalBond from '../packages/@elysia-ai/bond/src/index.js'
import * as internalBrain from '../packages/@elysia-ai/brain/src/index.js'
import * as internalCognition from '../packages/@elysia-ai/cognition/src/index.js'
import * as internalDialogue from '../packages/@elysia-ai/dialogue/src/index.js'
import * as internalHomeostasis from '../packages/@elysia-ai/homeostasis/src/index.js'
import * as internalMemory from '../packages/@elysia-ai/memory/src/index.js'
import * as internalModelGateway from '../packages/@elysia-ai/model-gateway/src/index.js'
import * as internalObservatory from '../packages/@elysia-ai/observatory/src/index.js'
import * as internalPerception from '../packages/@elysia-ai/perception/src/index.js'
import * as internalPersona from '../packages/@elysia-ai/persona/src/index.js'

import * as behaviorPlugin from '../packages/elysia-ai-behavior/src/index.js'
import * as bondPlugin from '../packages/elysia-ai-bond/src/index.js'
import * as brainPlugin from '../packages/elysia-ai-brain/src/index.js'
import * as cognitionPlugin from '../packages/elysia-ai-cognition/src/index.js'
import * as dialoguePlugin from '../packages/elysia-ai-dialogue/src/index.js'
import * as homeostasisPlugin from '../packages/elysia-ai-homeostasis/src/index.js'
import * as memoryPlugin from '../packages/elysia-ai-memory/src/index.js'
import * as modelGatewayPlugin from '../packages/elysia-ai-model-gateway/src/index.js'
import * as observatoryPlugin from '../packages/elysia-ai-observatory/src/index.js'
import * as perceptionPlugin from '../packages/elysia-ai-perception/src/index.js'
import * as personaPlugin from '../packages/elysia-ai-persona/src/index.js'

const internalPackages = [
  ['behavior', internalBehavior, 'createBehaviorPluginRuntime'],
  ['bond', internalBond, 'createBondPluginRuntime'],
  ['brain', internalBrain, 'createBrainPluginRuntime'],
  ['cognition', internalCognition, 'createCognitionPluginRuntime'],
  ['dialogue', internalDialogue, 'createDialoguePluginRuntime'],
  ['homeostasis', internalHomeostasis, 'createHomeostasisPluginRuntime'],
  ['memory', internalMemory, 'createMemoryPluginRuntime'],
  ['model-gateway', internalModelGateway, 'createModelGatewayPluginRuntime'],
  ['observatory', internalObservatory, 'createObservatoryPluginRuntime'],
  ['perception', internalPerception, 'createPerceptionPluginRuntime'],
  ['persona', internalPersona, 'createPersonaPluginRuntime'],
] as const

const pluginPackages = [
  ['behavior', behaviorPlugin],
  ['bond', bondPlugin],
  ['brain', brainPlugin],
  ['cognition', cognitionPlugin],
  ['dialogue', dialoguePlugin],
  ['homeostasis', homeostasisPlugin],
  ['memory', memoryPlugin],
  ['model-gateway', modelGatewayPlugin],
  ['observatory', observatoryPlugin],
  ['perception', perceptionPlugin],
  ['persona', personaPlugin],
] as const

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(fullPath)
    return entry.isFile() && fullPath.endsWith('.ts') ? [fullPath] : []
  })
}

describe('Phase 41 plugin boundary', () => {
  it.each(internalPackages)('@elysia-ai/%s exposes factory but not Koishi plugin entry', (_capabilityName, internalPackage, factoryName) => {
    expect(internalPackage.name).toBeUndefined()
    expect(internalPackage.apply).toBeUndefined()
    expect(internalPackage.applyInternal).toBeUndefined()
    expect(typeof internalPackage.internalName).toBe('string')
    expect(typeof internalPackage[factoryName]).toBe('function')
  })

  it.each(pluginPackages)('packages/elysia-ai-%s exposes the official Koishi plugin entry', (capabilityName, pluginPackage) => {
    expect(pluginPackage.name).toBe(`elysia-ai-${capabilityName}`)
    expect(pluginPackage.Config).toBeTruthy()
    expect(typeof pluginPackage.apply).toBe('function')
  })

  it('internal capability packages do not import Koishi directly', () => {
    const sourceFiles = collectSourceFiles(join(__dirname, '..', 'packages', '@elysia-ai'))
      .filter((file) => !file.includes(`${join('packages', '@elysia-ai', 'shared')}`))
    const offenders = sourceFiles.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /from ['"]koishi['"]/.test(source) || /declare module ['"]koishi['"]/.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('internal capability factories do not perform Koishi service wiring', () => {
    const sourceFiles = internalPackages.flatMap(([dir]) => collectSourceFiles(join(__dirname, '..', 'packages', '@elysia-ai', dir, 'src')))
    const forbiddenPatterns = [
      /getRequiredElysiaService/,
      /getOptionalElysiaService/,
      /registerElysiaService/,
      /\bctx\./,
      /legacyName:\s*['"]elysia-ai-/,
      /\[['"]elysia-ai-/,
    ]


    const offenders = sourceFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return forbiddenPatterns.some((pattern) => pattern.test(source)) ? [file] : []
    })

    expect(offenders).toEqual([])
  })
})
