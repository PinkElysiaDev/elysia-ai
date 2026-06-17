import type { CoreEventMap } from '@elysia-ai/core'
import type { EventBus } from '@elysia-ai/core'
import type { Lifecycle, LifecycleState } from './index.js'

/**
 * MinimalLifecycle
 *
 * 最小化的生命周期实现。
 *
 * 合法状态转移链：
 *   idle → starting → running → stopping → stopped
 *
 * start() 前置条件：state === 'idle'
 * stop()  前置条件：state === 'running'
 *
 * 其他状态下调用均会抛出错误，防止并发调用造成状态污染。
 */
export class MinimalLifecycle implements Lifecycle {
  private state: LifecycleState = 'idle'
  private eventBus: EventBus<CoreEventMap>

  constructor(eventBus: EventBus<CoreEventMap>) {
    this.eventBus = eventBus
  }

  getState(): LifecycleState {
    return this.state
  }

  isRunning(): boolean {
    return this.state === 'running'
  }

  /**
   * 启动 runtime。
   *
   * 前置条件：state === 'idle'
   * 后置状态：state === 'running'
   *
   * 在 starting / running / stopping / stopped 状态下调用均会抛出错误，
   * 防止重入和并发调用造成状态污染。
   *
   * @throws 当前状态不是 'idle' 时抛出错误
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(
        `Cannot start runtime: current state is "${this.state}", expected "idle". ` +
        `Did you call start() twice, or start() after stop()?`
      )
    }

    this.state = 'starting'
    await this.eventBus.emit('runtime.starting', { timestamp: Date.now() })

    // TODO: 未来在这里添加启动逻辑，例如恢复持久化状态、初始化 registry 等
    // 目前保持最小实现

    this.state = 'running'
    await this.eventBus.emit('runtime.started', { timestamp: Date.now() })
  }

  /**
   * 停止 runtime。
   *
   * 前置条件：state === 'running'
   * 后置状态：state === 'stopped'
   *
   * 在 idle / starting / stopping / stopped 状态下调用均会抛出错误，
   * 防止重入和并发调用造成状态污染。
   *
   * 注意：runtime 层的 stop() 已处理幂等逻辑（stopped 时静默），
   * 此方法只负责单次合法的状态转移。
   *
   * @throws 当前状态不是 'running' 时抛出错误
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      throw new Error(
        `Cannot stop runtime: current state is "${this.state}", expected "running". ` +
        `Did you call stop() twice, or stop() before start()?`
      )
    }

    this.state = 'stopping'
    await this.eventBus.emit('runtime.stopping', { timestamp: Date.now() })

    // TODO: 未来在这里添加清理逻辑，例如持久化最终状态、清理定时器等
    // 目前保持最小实现

    this.state = 'stopped'
    await this.eventBus.emit('runtime.stopped', { timestamp: Date.now() })
  }
}
