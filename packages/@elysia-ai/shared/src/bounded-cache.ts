/**
 * 有界 LRU 缓存：get/set 都会刷新插入序，超过 maxSize 时淘汰最久未访问的条目。
 * 用于 behavior / cognition 等插件缓存最近的 stimulus / perception / cognition 上下文。
 */
export class BoundedCache<K, V> {
  private readonly store = new Map<K, V>()

  constructor(private readonly maxSize = 200) {}

  set(key: K, value: V): void {
    if (this.store.has(key)) this.store.delete(key)
    this.store.set(key, value)
    if (this.store.size > this.maxSize) {
      const firstKey = this.store.keys().next().value
      if (firstKey !== undefined) this.store.delete(firstKey)
    }
  }

  get(key: K): V | undefined {
    const value = this.store.get(key)
    if (value === undefined) return undefined
    this.store.delete(key)
    this.store.set(key, value)
    return value
  }

  delete(key: K): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  /** 全部值快照（按 LRU 访问序，最近访问在后；不刷新访问序）。 */
  values(): V[] {
    return [...this.store.values()]
  }

  /** 全部键快照（不刷新访问序）。 */
  keys(): K[] {
    return [...this.store.keys()]
  }

  get size(): number {
    return this.store.size
  }
}
