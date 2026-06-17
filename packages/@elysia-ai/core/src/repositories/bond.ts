import type { Bond, BondQuery, BondQueryOptions, BondSearchResult, BondTargetType } from '../types/bond.js'

export interface BondRepository {
  getById(id: string): Promise<Bond | undefined>
  getByLifeAndTarget(
    lifeId: string,
    targetId: string,
    targetType?: BondTargetType
  ): Promise<Bond | undefined>
  listByLife(lifeId: string, options?: BondQueryOptions): Promise<Bond[]>
  save(bond: Bond): Promise<void>
  update(id: string, patch: Partial<Bond>): Promise<Bond>
  remove(id: string): Promise<void>
  query(query: BondQuery): Promise<BondSearchResult>
}
