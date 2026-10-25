import type { TriggerTask } from '../types/trigger-task.js'

export interface TriggerTaskQuery {
  habitatId?: string
  ownerKey?: string
  enabled?: boolean
}

/**
 * 定时触发器任务仓储。
 * v1 内存实现为主（重启后由 LLM/管理员重建或后续接 mongo）；
 * 接口对齐既有仓储模式（接口在 core、实现在消费方插件）。
 */
export interface TriggerTaskRepository {
  save(task: TriggerTask): Promise<void>
  /**
   * CAS 认领（防重核心）：仅当任务仍为 waiting 且 occurrenceKey 匹配时
   * 原子置为 running，返回是否抢到。多进程共享 Mongo 时保证一轮触发
   * 最多一个进程执行；内存实现为进程内同步 CAS。
   */
  claim(taskId: string, expectedOccurrenceKey: string, now: number): Promise<boolean>
  /**
   * 认领冲突提示（可选窄写）：仅在任务已处 running 态时附写 lastError，
   * 绝不整体覆盖——认领失败方持有的是过期快照。
   */
  markClaimConflict?(taskId: string): Promise<void>
  get(id: string): Promise<TriggerTask | null>
  query(query?: TriggerTaskQuery): Promise<TriggerTask[]>
  /**
   * 【D】到期收割直查：返回当前时刻应处理的任务（enabled 且
   * waiting+nextRunAt<=now，或 paused+pausedUntil<=now）。
   * Mongo 实现下推为单次 $or 服务端查询（取代全量 query() 后内存过滤）；
   * 内存实现为进程内过滤。排序不保证（调用方逐个 CAS 认领）。
   */
  listDue(now: number): Promise<TriggerTask[]>
  remove(id: string): Promise<boolean>
  countByOwner(ownerKey: string): Promise<number>
}
