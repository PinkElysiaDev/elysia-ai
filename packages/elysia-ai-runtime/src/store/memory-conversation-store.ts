import type { ConversationEntry, ConversationStore } from '@elysia-ai/core'

const DEFAULT_MAX_ENTRIES_PER_SCOPE = 50

export class MemoryConversationStore implements ConversationStore {
  private readonly entries = new Map<string, ConversationEntry[]>()

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
