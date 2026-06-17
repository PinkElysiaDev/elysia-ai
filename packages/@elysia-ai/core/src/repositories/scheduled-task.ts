import type { ScheduledTask } from '../types/scheduler.js'

export interface ScheduledTaskRepository {
  save(task: ScheduledTask): Promise<void>
  getById(id: string): Promise<ScheduledTask | null>
  listDue(now: number, limit?: number): Promise<ScheduledTask[]>
  listByLifeId(lifeId: string): Promise<ScheduledTask[]>
  listAll(): Promise<ScheduledTask[]>
  complete(id: string): Promise<void>
  fail(id: string, error: string, nextRunAt?: number): Promise<void>
  cancel(id: string, reason?: string): Promise<void>
  remove(id: string): Promise<void>
}
