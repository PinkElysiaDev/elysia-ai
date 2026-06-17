import type { ModelGatewayRequest, RoutingResult } from '@elysia-ai/core'
import { ProviderError } from '../providers/index.js'
import { ProviderRegistry } from '../registry/index.js'

export class GatewayRouter {
  constructor(private readonly registry: ProviderRegistry) {}

  resolve(request: ModelGatewayRequest): RoutingResult {
    // Priority 1: slot-based routing
    if (request.slot) {
      const provider = this.registry.resolveSlot(request.slot)
      if (provider) {
        return {
          provider: provider.descriptor,
          reason: 'slot-matched',
          metadata: { slot: request.slot },
        }
      }
    }

    // Priority 2: default slot
    const defaultProvider = this.registry.resolveDefaultSlot()
    if (defaultProvider) {
      return {
        provider: defaultProvider.descriptor,
        reason: 'default-slot',
      }
    }

    throw new ProviderError(
      'No provider available for request',
      request.slot ?? 'unknown',
      undefined,
      { slot: request.slot }
    )
  }
}
