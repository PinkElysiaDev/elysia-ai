import type { Stimulus } from '@elysia-ai/core'
import type { Runtime } from '../runtime.js'

/**
 * Runtime 生命周期状态
 */
export type LifecycleState = 
  | 'idle'      // 初始化完成，未启动
  | 'starting'  // 正在启动
  | 'running'   // 正在运行
  | 'stopping'  // 正在停止
  | 'stopped'   // 已停止

/**
 * Lifecycle 接口
 * 管理 runtime 的启动和停止生命周期
 */
export interface Lifecycle {
  /**
   * 获取当前状态
   */
  getState(): LifecycleState

  /**
   * 启动 runtime
   * - 检查状态是否为 idle
   * - 发出 runtime.starting 事件
   * - 初始化内部状态
   * - 发出 runtime.started 事件
   */
  start(): Promise<void>

  /**
   * 停止 runtime
   * - 检查状态是否为 running
   * - 发出 runtime.stopping 事件
   * - 清理内部状态
   * - 发出 runtime.stopped 事件
   */
  stop(): Promise<void>

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean
}

/**
 * 处理刺激的生命周期钩子
 * 用于插件扩展 runtime 的刺激处理流程
 */
export interface RuntimeLifecycle {
  handleStimulus(runtime: Runtime, stimulus: Stimulus): Promise<void>
}
