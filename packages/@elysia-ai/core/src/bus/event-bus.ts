
export interface EventBus<EventMap extends object> {
  /**
   * 向所有订阅者派发事件。
   *
   * 契约：listener 之间相互隔离。单个 listener 抛出的错误必须被实现内部捕获并记录，
   * 不得中断其余 listener 的执行，也不得向 emit 调用方（事件发布者）冒泡。
   * 事件总线是多订阅者的，发布者不应因某个订阅者失败而感知到异常。
   */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void | Promise<void>
  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void | Promise<void>
  ): () => void
  once<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void | Promise<void>
  ): () => void
}
