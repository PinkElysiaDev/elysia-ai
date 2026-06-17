import type { Provider, ProviderConfig } from './types.js'
import { createOpenAIProvider } from './openai.js'

export function createOpenAICompatibleProvider(config: ProviderConfig): Provider {
  const endpoint = config.endpoint?.replace(/\/+$/, '')
  const provider = createOpenAIProvider({
    ...config,
    endpoint,
    mode: config.mode ?? 'chat-completions',
  })

  return {
    id: config.id,
    descriptor: {
      id: config.id,
      type: 'openai-compatible',
      model: config.model,
      endpoint,
    },
    async execute(request) {
      const result = await provider.execute(request)
      return {
        ...result,
        provider: {
          id: config.id,
          type: 'openai-compatible',
          model: request.model ?? config.model,
          endpoint,
        },
      }
    },
  }
}
