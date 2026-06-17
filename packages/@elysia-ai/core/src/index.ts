// ─────────────────────────────────────────────────────────────────────────────
// 核心领域类型（LifeInstance / Habitat / Bond / Thread / Stimulus 等）
// ─────────────────────────────────────────────────────────────────────────────
export * from './types/life.js'
export * from './types/habitat.js'
export * from './types/bond.js'
export * from './types/thread.js'
export * from './types/projection.js'
export * from './types/stimulus.js'
export * from './types/behavior.js'
export * from './types/behavior-execution.js'
export * from './types/dialogue.js'
export * from './types/persona.js'
export * from './types/memory.js'
export * from './types/scheduler.js'
export * from './types/perception.js'
export * from './types/homeostasis.js'
export * from './types/cognition.js'
export * from './types/services.js'

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema（运行时校验）
// D3-2 起，memory / behavior / homeostasis / dialogue / persona 的 schema 已补齐，
// 与下方核心领域类型基本一一对应（仍以类型定义为准，schema 为运行时校验副本）。
// ─────────────────────────────────────────────────────────────────────────────
export * from './schemas/life.js'
export * from './schemas/habitat.js'
export * from './schemas/bond.js'
export * from './schemas/thread.js'
export * from './schemas/projection.js'
export * from './schemas/stimulus.js'
export * from './schemas/memory.js'
export * from './schemas/behavior.js'
export * from './schemas/homeostasis.js'
export * from './schemas/dialogue.js'
export * from './schemas/persona.js'

// ─────────────────────────────────────────────────────────────────────────────
// 事件总线（接口 + 事件类型映射 + 默认内存实现）
// ─────────────────────────────────────────────────────────────────────────────
export * from './bus/event-bus.js'
export * from './bus/event-map.js'
export * from './bus/memory-event-bus.js'

// ─────────────────────────────────────────────────────────────────────────────
// Repository 抽象接口（只有接口定义，不含 MongoDB/Redis 实现）
// ─────────────────────────────────────────────────────────────────────────────
export * from './repositories/bond.js'
export * from './repositories/life.js'
export * from './repositories/projection-rule.js'
export * from './repositories/scheduled-task.js'
export * from './repositories/state.js'
export * from './repositories/stimulus.js'
export * from './repositories/trace.js'

// ─────────────────────────────────────────────────────────────────────────────
// Dialogue / Brain / Model Gateway 抽象接口
// ─────────────────────────────────────────────────────────────────────────────
export * from './dialogue/dialogue.js'
export * from './brain/brain.js'
export * from './brain/model-gateway.js'

// ─────────────────────────────────────────────────────────────────────────────
// 通用错误类型
// ─────────────────────────────────────────────────────────────────────────────
export * from './errors/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// 插件标准接口（Manifest / PipelineContext / Hooks）
// 参见：docs/elysia-ai-plugin-development-spec.md
// ─────────────────────────────────────────────────────────────────────────────
export * from './plugin/index.js'
