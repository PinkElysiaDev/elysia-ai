/**
 * 有界缓存，超过 maxSize 时自动淘汰最早插入的条目。
 * 用于 behavior / cognition / perception 等插件缓存最近的 stimulus / perception / homeostasis 等上下文。
 */
export class BoundedCache<K, V> {
  private readonly store = new Map<K, V>()

  constructor(private readonly maxSize = 200) {}

  set(key: K, value: V): void {
    this.store.set(key, value)
    if (this.store.size > this.maxSize) {
      const firstKey = this.store.keys().next().value
      if (firstKey !== undefined) this.store.delete(firstKey)
    }
  }

  get(key: K): V | undefined {
    return this.store.get(key)
  }

  delete(key: K): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}
