export type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
export { ProviderError } from './types.js'
export { createOpenAIProvider } from './openai.js'
export { createOpenAICompatibleProvider } from './openai-compatible.js'
export { createGeminiProvider } from './gemini.js'
export { createClaudeProvider } from './claude.js'

import type { Provider, ProviderConfig } from './types.js'
import { createOpenAIProvider } from './openai.js'
import { createOpenAICompatibleProvider } from './openai-compatible.js'
import { createGeminiProvider } from './gemini.js'
import { createClaudeProvider } from './claude.js'

export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case 'openai':
      return createOpenAIProvider(config)
    case 'openai-compatible':
      return createOpenAICompatibleProvider(config)
    case 'gemini':
      return createGeminiProvider(config)
    case 'claude':
      return createClaudeProvider(config)
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`)
  }
}
