export type { Provider, ProviderConfig, ProviderRequest, ProviderResponse } from './types.js'
export { ProviderError } from './types.js'
export { createChatCompletionsProvider } from './chat-completions.js'
export { createResponsesProvider } from './responses.js'
export { createGeminiProvider } from './gemini.js'
export { createAnthropicProvider } from './anthropic.js'
export { createCustomProvider, resolveProtocolDefinition } from './custom.js'

import type { Provider, ProviderConfig } from './types.js'
import { createChatCompletionsProvider } from './chat-completions.js'
import { createResponsesProvider } from './responses.js'
import { createGeminiProvider } from './gemini.js'
import { createAnthropicProvider } from './anthropic.js'
import { createCustomProvider } from './custom.js'
import { CUSTOM_PROTOCOL_PRESETS } from '@elysia-ai/protocol-custom'

export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case 'chat-completions':
      return createChatCompletionsProvider(config)
    case 'responses':
      return createResponsesProvider(config)
    case 'gemini':
      return createGeminiProvider(config)
    case 'anthropic':
      return createAnthropicProvider(config)
    case 'custom':
      return createCustomProvider(config, CUSTOM_PROTOCOL_PRESETS)
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`)
  }
}
