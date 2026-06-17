import type { Provider, ProviderConfig } from '../providers/index.js'
import { createProvider } from '../providers/index.js'

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map()
  private slotMap: Map<string, string> = new Map()
  private defaultSlotName: string | undefined

  register(config: ProviderConfig): Provider {
    return this.registerProvider(createProvider(config))
  }

  registerProvider(provider: Provider): Provider {
    this.providers.set(provider.id, provider)
    return provider
  }

  registerSlot(slotName: string, providerId: string): void {
    this.slotMap.set(slotName, providerId)
  }

  setDefaultSlot(slotName: string): void {
    this.defaultSlotName = slotName
  }

  resolveSlot(slotName: string): Provider | undefined {
    const providerId = this.slotMap.get(slotName)
    if (!providerId) return undefined
    return this.providers.get(providerId)
  }

  resolveDefaultSlot(): Provider | undefined {
    if (!this.defaultSlotName) return undefined
    return this.resolveSlot(this.defaultSlotName)
  }

  getSlotNames(): string[] {
    return Array.from(this.slotMap.keys())
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id)
  }

  getAll(): Provider[] {
    return Array.from(this.providers.values())
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  get size(): number {
    return this.providers.size
  }
}
