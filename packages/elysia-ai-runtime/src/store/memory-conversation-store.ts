import type { ConversationEntry, ConversationStore } from '@elysia-ai/core'
import { BoundedCache } from '@elysia-ai/shared'

const DEFAULT_MAX_ENTRIES_PER_SCOPE = 50
/** W3：外层 scope 键数上限——无界 Map 在多会话场景下只增不减（内存泄漏）。 */
const DEFAULT_MAX_SCOPES = 300

export class MemoryConversationStore implements ConversationStore {
  private readonly entries = new BoundedCache<string, ConversationEntry[]>(DEFAULT_MAX_SCOPES)

  constructor(private readonly maxEntriesPerScope = DEFAULT_MAX_ENTRIES_PER_SCOPE) {}

  append(scopeKey: string, entry: ConversationEntry): void {
    const list = this.entries.get(scopeKey) ?? []
    list.push({
      ...entry,
      scopeKey,
    })

    if (list.length > this.maxEntriesPerScope) {
      list.splice(0, list.length - this.maxEntriesPerScope)
    }

    this.entries.set(scopeKey, list)
  }

  getRecent(scopeKey: string, limit = this.maxEntriesPerScope): ConversationEntry[] {
    const list = this.entries.get(scopeKey) ?? []
    return list.slice(-limit)
  }

  clear(scopeKey: string): void {
    this.entries.delete(scopeKey)
  }
}
