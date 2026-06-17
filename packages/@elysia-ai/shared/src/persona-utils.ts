import type { Persona } from '@elysia-ai/core'

/**
 * 检查 persona 是否包含匹配指定模式的 trait。
 * 支持中英文模糊匹配（包含关系）。
 */
export function hasPersonaTrait(persona: Persona | undefined, patterns: string[]): boolean {
  if (!persona?.traits?.length) return false

  const normalizedPatterns = patterns.map((p) => p.trim().toLowerCase())
  return persona.traits.some((trait) => {
    const normalizedTrait = trait.trim().toLowerCase()
    return normalizedPatterns.some((pattern) => normalizedTrait.includes(pattern))
  })
}
