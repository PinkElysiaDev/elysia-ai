// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Elysia A.I. Shared Utilities
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export { createPluginLogger } from './logger.js'
export type { PluginLogger } from './logger.js'
export { BoundedCache } from './bounded-cache.js'
export { parseAiJsonResponse, safeNumber } from './ai-utils.js'
export { hasPersonaTrait } from './persona-utils.js'
export {
  createSelectionDiagnostics,
  isTimeoutError,
  normalizeReasonById,
  normalizeSelectedIds,
  parseJsonObjectFromText,
  withTimeout,
} from './relevance-selection.js'
export type {
  ParsedRelevanceSelection,
  RelevanceSelectionDiagnosticsOptions,
} from './relevance-selection.js'


export { registerElysiaService, getOptionalElysiaService, getRequiredElysiaService } from './service-registry.js'
export type { ElysiaServiceLogger, RegisterElysiaServiceOptions, ElysiaServiceLookupOptions } from './service-registry.js'

export { createPreflightResult, issue, combinePreflightResults } from './preflight.js'
export type { PreflightIssue, PreflightResult, PreflightSeverity } from './preflight.js'

export { clampUnit, clampUnitOr, clampPercent } from './numeric-utils.js'
export { extractTextFromStimulus } from './stimulus-utils.js'
export { resolveConversationScope, createConversationScopeKey } from './conversation-scope.js'
export type { ConversationScope, ConversationScopeType } from './conversation-scope.js'

export { createElysiaPlugin } from './plugin-factory.js'
export type {
  ElysiaPluginLogger,
  ElysiaPluginRuntimeHandle,
  ElysiaPluginBuildContext,
  ElysiaPluginDescriptor,
} from './plugin-factory.js'

export { AiAssistedRelevanceSelectorBase } from './ai-relevance-selector.js'
export type {
  RelevanceEventEmitter,
  RelevanceSelectorLogger,
  RelevanceRequestLike,
  RelevanceResultLike,
  AiAssistedRelevanceSelectorOptionsLike,
  RelevanceSelectorDescriptor,
} from './ai-relevance-selector.js'

export { MongoDocRepository } from './mongo-doc-repository.js'
export type {
  MongoCursorLike,
  MongoDocLikeCollection,
  MongoFindOptions,
  MongoIndexSpec,
  MongoDocRepositoryConfig,
} from './mongo-doc-repository.js'

export { connectMongo } from './mongo-connector.js'
export type {
  MongoConnectionConfig,
  MongoClientLike,
  MongoConnectorDependencies,
  MongoConnection,
} from './mongo-connector.js'
