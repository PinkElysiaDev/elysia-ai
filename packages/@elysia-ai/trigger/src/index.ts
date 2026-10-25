export const internalName = 'elysia-ai-trigger'

export type { TriggerEvent } from './event.js'
export {
  EVENT_CATALOG,
  formatEventFeedLine,
  getCatalogEntry,
  isBatchableEventKey,
  isEventEnabled,
  isFeedIncluded,
  isSystemEventKey,
  stimulusToTriggerEvent,
} from './event-catalog.js'
export type { EventCatalogEntry, EventCatalogGroup, EventSwitchConfig } from './event-catalog.js'
export { EventHistory } from './event-history.js'
export type { EventHistoryOptions, FeedBuildOptions } from './event-history.js'
export { AdaptiveBatcher, DEFAULT_BATCHER_CONFIG } from './batcher.js'
export type { BatchFire, BatchReason, BatcherConfig, BatcherDeps, BatcherPendingState } from './batcher.js'
export { EventsPackMemory } from './pack-memory.js'
export type { EventsPackEntry, PackMemoryOptions, WakeSource } from './pack-memory.js'
export { CommandSystem } from './commands.js'
export type { CommandAction, CommandExecResult, CommandItem, CommandPermission, CommandSystemDeps } from './commands.js'
export { InstantEngine, DEFAULT_INSTANT_RULES } from './instant.js'
export type { InstantAction, InstantCondition, InstantEngineDeps, InstantItem, InstantMatchResult } from './instant.js'
export { expandTemplate } from './template.js'
export type { MatchInfo } from './template.js'
export type { TriggerCondition, TriggerMisfirePolicy, TriggerTask, TriggerTaskState, TriggerTaskStatus } from './trigger-task.js'
export { createInitialTriggerState, normalizeTriggerCondition } from './trigger-task.js'
export { computeNextOccurrence, validateTriggerCondition, initialTriggerState, afterTriggerRun, resolveMisfire } from './trigger-planner.js'
export type { TriggerOccurrence } from './trigger-planner.js'
