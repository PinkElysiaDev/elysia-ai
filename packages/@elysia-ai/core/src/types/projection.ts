export type ProjectionStatus = 'inactive' | 'active' | 'archived'

export interface Projection {
  id: string
  lifeId: string
  habitatId: string
  bodyId?: string
  botId?: string
  platform?: string
  status: ProjectionStatus
  priority: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface ProjectionRule {
  id: string
  lifeId: string
  enabled?: boolean
  priority: number
  habitatId?: string
  channelId?: string
  threadId?: string
  actorId?: string
  platform?: string
  botId?: string
  metadata?: Record<string, unknown>
}

export interface ProjectionRoutingResult {
  stimulusId: string
  habitatId: string
  lifeIds: string[]
  projectionIds: string[]
  routedAt: number
  reason: string
  matchedRules?: ProjectionRule[]
  metadata?: Record<string, unknown>
}

export interface ProjectionResolver {
  /**
   * 根据 stimulus 的 habitatId / botId / platform 等信息，
   * 解析出应该感知并响应该 stimulus 的 life 实例列表。
   *
   * 返回 ProjectionRoutingResult，其中 lifeIds 为空表示无匹配。
   */
  resolve(stimulus: import('./stimulus.js').Stimulus): ProjectionRoutingResult
}
