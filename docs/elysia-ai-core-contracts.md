# Elysia A.I. Core Contracts

## 文档用途

本文档用于定义 **Elysia A.I. 当前 `core` 层的正式契约边界**。

本文档以当前代码、`package.json`、`tsconfig` 与 Koishi monorepo 可运行结构为准。
早期文档中曾把逻辑层名、目录名和 npm 包名直接等同，这是不准确的。

它主要回答：

- `core` 在当前结构中的真实角色是什么
- `core` 负责哪些正式对象、事件和抽象接口
- `core` 不应该承担什么职责
- 新的包结构下，其他包应该如何依赖 `core`

本文档适合：

- 开发 `@elysia-ai/core`
- 检查 `runtime/body/behavior/dialogue/brain/model-gateway` 是否正确依赖 `core`
- 让新协作窗口快速理解当前正式契约面

---

## 1. 当前真实路径与逻辑角色

文档中提到的 `core`，逻辑上指的是：

> **Elysia A.I. 的公共协议层**

当前真实工程位置是：

```txt
packages/@elysia-ai/core
```

也就是说：

- 文档仍然使用“core”描述它的逻辑角色
- 当前真实工程路径是：
  - `packages/@elysia-ai/core`
- 当前真实包名 / import 名称是：
  - `@elysia-ai/core`
- 后续不得根据目录名自行推导为 `@elysia-ai/core`

---

## 2. `core` 的定位

`core` 是 **Elysia A.I. 的公共语言与基础契约层**。

它的职责不是实现具体业务，而是定义：

- 核心对象
- 运行时 schema
- 事件总线接口
- repository 抽象
- dialogue / brain / model-gateway 抽象
- 通用错误类型
- 稳定导出入口

你可以把 `core` 理解为：

> 所有其他包都必须使用同一套内部语言，而这套语言定义在 `core` 中。

---

## 3. `core` 与其他包的关系

## 3.1 `core` 是内部协议包
`@elysia-ai/core`：

- 是当前真实 `core` 协议包名
- 不是 Koishi Loader 直接加载的宿主入口包
- 不承担宿主交付职责
- 不直接暴露宿主入口

包名中包含 `koishi-plugin` 片段是当前 Koishi monorepo 工程结构下的命名事实，不能据此判断它是宿主入口包。

它是：

- `elysia-ai-runtime`
- `elysia-ai-body`
- `@elysia-ai/behavior`
- `@elysia-ai/dialogue`
- `@elysia-ai/brain`
- `@elysia-ai/model-gateway`
- 以及其他能力包

共同依赖的协议层。

---

## 3.2 `core` 服务于宿主入口包和内部能力包
当前结构中：

### 宿主入口包
- `packages/elysia-ai-runtime`
- `packages/elysia-ai-body`

### 内部能力包
- `packages/@elysia-ai/*`

都应优先依赖 `@elysia-ai/core` 中的正式对象和抽象，
而不是在各自包内部重新定义一套语义相近但不兼容的对象。

---

## 4. `core` 不负责什么

为了避免边界污染，当前阶段 `core` 不负责：

- 不负责 `runtime` 生命周期逻辑
- 不负责 Koishi 平台接入
- 不负责 MongoDB 的具体读写实现
- 不负责 Redis 的具体缓存逻辑
- 不负责模型 provider 的具体 HTTP 请求
- 不负责具体行为策略
- 不负责具体人格、关系、记忆算法
- 不负责 prompt 构造和回复渲染
- 不负责宿主入口包的打包和发布策略
- 不负责具体日志实现

一句话总结：

> `core` 只定义正式语言和抽象边界，不实现宿主运行逻辑。

---

## 5. 当前阶段 `core` 的实现目标

当前阶段，`core` 的目标是：

1. 让所有主包有统一依赖目标
2. 让系统核心对象与命名稳定下来
3. 让事件、对话任务、认知请求和模型请求拥有统一结构
4. 为后续 `dialogue / brain / model-gateway` 的正式实现提供稳定边界

---

## 6. 当前阶段正式对象

下面这些对象构成当前阶段最重要的正式契约。

## 6.1 `LifeInstance`
表示一个虚拟生命体实例，是系统主语。

---

## 6.2 `Habitat`
表示生命体长期活动的环境。

---

## 6.3 `Bond`
表示生命体与其他主体之间的关系纽带。

Bond System v1 已进入 `core` 正式契约层，用于承接 behavior execution side-effect、后续 cognition / dialogue context enrichment 与长期关系事实源落地。

当前核心对象包括：

### `BondTargetType`

表示 bond 目标类型，当前支持：

- `actor`
- `life`
- `habitat`
- `thread`
- `projection`
- `external`
- `individual`
- `collective`
- `channel`

其中 `individual / collective / channel` 作为早期兼容目标类型保留。

### `BondStatus`

表示 bond 生命周期状态，当前支持：

- `active`
- `archived`
- `blocked`
- `deleted`

### `BondMetrics`

表示关系强度维度，当前包含：

- `familiarity`
- `intimacy`
- `trust`
- `tension`
- `dependence`

### `BondSource`

表示 bond 更新来源追踪，当前可承接：

- `stimulusId`
- `memoryId`
- `behaviorPlanId`
- `executionPlanId`
- `executionActionId`
- `event`
- `updatedBy`

### `Bond`

表示一条正式长期关系，当前包含：

- `id`
- `lifeId`
- `lifeInstanceId`
- `targetId`
- `targetType`
- `status`
- `metrics`
- `summary`
- `tags`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `source`
- `createdAt`
- `updatedAt`
- `lastInteractionAt`
- `interactionCount`
- `metadata`

`familiarity / intimacy / trust` 顶层字段作为兼容旧代码路径的可选字段保留，正式读写应优先使用 `metrics`。

### `BondUpdateRequest`

表示 execution layer 或其他能力层提出的关系写入请求。
当前 behavior execution 的 `bond-update` action 会发出 `behavior.bond.update.requested`，由 runtime 默认 `BondService` 消费。

### `BondQuery` / `BondSearchResult`

表示 bond 检索请求与结果。当前检索维度包括：

- `lifeId`
- `targetId`
- `targetType`
- `status`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `tags`
- `minFamiliarity`
- `minIntimacy`
- `minTrust`
- `minTension`
- `minDependence`
- `updatedAfter / updatedBefore`
- `limit / offset`
- `orderBy / order`

### `BondRepository`

表示长期关系事实源抽象，当前包含：

- `getById(id)`
- `getByLifeAndTarget(lifeId, targetId, targetType?)`
- `save(bond)`
- `update(id, patch)`
- `remove(id)`
- `query(query)`
- `listByLife(lifeId, options?)`

### `BondService`

表示 bond 策略边界，当前包含：

- `update(request)`
- `retrieve(query)`

注意：`core` 只定义 bond 契约，不实现具体存储。
runtime 当前提供默认内存实现：

- `MemoryBondRepository`
- `DefaultBondService`
- `RuleBasedBondContextProvider`
- `RuleBasedBondRelevanceSelector`
- `AiAssistedBondRelevanceSelector`

### `BondRelevanceSelectionRequest` / `BondRelevanceSelector`

表示 bond 检索侧的候选相关性选择请求、结果与策略边界。

Bond Relevance Selection v1 用于在结构化召回候选之后，对候选 bond 做最终选择、重排与解释。它的设计原则与 memory relevance selection 对齐：LLM 不直接查询 repository，只能在 rule-based provider 已召回的候选集合中选择。

当前核心对象包括：

- `BondRelevanceSelectionRequest`
  - `contextRequest`
  - `candidates`
  - `content`
  - `limit`
  - `mode`
  - `metadata`
- `BondRelevanceSelectionResult`
  - `items`
  - `selectedIds`
  - `rejectedIds`
  - `reason`
  - `usedAI`
  - `fallbackReason`
  - `metadata`
- `BondRelevanceSelector`
  - `select(request)`

runtime 当前提供：

- `RuleBasedBondRelevanceSelector`
  - 按候选 `score` 排序并截断
  - 默认 `usedAI: false`
- `AiAssistedBondRelevanceSelector`
  - 使用 `BrainService` 的 `bond-relevance-selection` capability 请求 JSON 选择结果
  - 根据模型返回的 `selectedIds / reasonById` 重排与解释候选
  - AI 失败、JSON 解析失败或无合法 selectedIds 时 fallback 到 rule-based selector

相关事件：

- `bond.relevance.selection.requested`
- `bond.relevance.selection.completed`
- `bond.relevance.selection.failed`
- `bond.relevance.selection.fallback`

### `BondContextRequest` / `BondContextPack`

表示 bond 检索侧的上下文构建请求与结果。

Bond Context Injection v1 用于把长期关系从“可查询事实源”推进为“可被 dialogue / brain 主链消费的上下文包”。它不直接暴露裸 `Bond[]` 给 brain，而是输出带评分、命中来源和原因的 context item。

runtime 当前提供 `RuleBasedBondContextProvider`，它会按 actor、thread、habitat、projection、target、metrics 与 recency 多路召回候选关系，去重后按目标命中、关系指标、互动次数与最近交互打分排序，并输出 `BondContextPack`。该 provider 当前支持注入 `BondRelevanceSelector`，用于在 scored candidates 之后接管最终上下文选择。

dialogue 当前可通过 runtime 注入的 `bondContextProvider` 在构造 `BrainRequest` 前构建 bond context；brain 会把 `BrainRequest.bondContext` 注入 system message 的关系上下文 section。

---

## 6.4 `Thread`
表示事件线、主题线或剧情线。

---

## 6.5 `Projection`
表示某个生命体在特定 body / habitat / bot 下的投射。
当前已进入 `core` 正式类型层，用于承接 runtime routing 与 projection trace。

当前 projection routing 已支持规则化路由，核心对象包括：

### `ProjectionRule`

表示一条 life 感知规则，当前包含：

- `id`
- `lifeId`
- `enabled`
- `priority`
- `habitatId`
- `channelId`
- `threadId`
- `actorId`
- `platform`
- `botId`
- `metadata`

runtime 通过 `MemoryProjectionRegistry` 管理运行期规则，并可从 manifest `extensions.projection.rules` 自动写入 repository 后注册到 registry。

当前 projection rules 已补入持久化抽象与运行时管理层：

### `ProjectionRuleRepository`

表示 projection rules 的长期事实源抽象，当前包含：

- `getById(id)`
- `listByLifeId(lifeId)`
- `listEnabled()`
- `listAll()`
- `save(rule)`
- `remove(id)`

该接口位于 `core` repository 抽象层，只定义契约，不实现 MongoDB / Redis 具体逻辑。

runtime 当前提供：
- `MemoryProjectionRuleRepository`
- `ProjectionRuleService`

`ProjectionRuleService` 负责协调 repository、runtime registry 与事件总线，当前支持：
- 从 repository 加载 enabled rules 到 registry
- upsert rule
- disable rule
- remove rule
- list rules

Projection rule 运行期变更会发出：
- `projection.rule.updated`
- `projection.rule.disabled`
- `projection.rule.removed`

### `ProjectionRoutingResult`

表示一次 stimulus routing 的结果，当前包含：

- `stimulusId`
- `habitatId`
- `lifeIds`
- `projectionIds`
- `routedAt`
- `reason`
- `matchedRules`
- `metadata`

当前默认策略为：
- 无任何 projection rules 时，fallback 到所有 active life
- 存在 projection rules 时，只路由到命中规则的 active life
- 命中规则按 `priority` 从高到低排序

---

## 6.6 `ScheduledTask`
表示数字生命的未来行为调度任务。

当前 scheduler 只承接最小闭环，不包含 cron、分布式锁、复杂 UI 等生产级能力。

当前包含：

- `id`
- `type`
  - `followup`
  - `delayed-response`
  - `homeostasis-tick`
  - `memory-consolidation`
  - `retry`
  - `proactive-behavior`
- `status`
  - `pending`
  - `running`
  - `completed`
  - `failed`
  - `cancelled`
  - `expired`
- `target`
  - `lifeId`
  - `habitatId`
  - `channelId`
  - `threadId`
  - `actorId`
  - `platform`
  - `botId`
- `runAt`
- `priority`
- `payload`
- `attempts`
- `maxAttempts`
- `expiresAt`

runtime 当前提供：

- `MemoryScheduledTaskRepository`
- `DefaultSchedulerService`

`DefaultSchedulerService` 当前支持：

- `schedule()`
- `cancel()`
- `tick()`
- `runTask()`
- `listTasks()`

Scheduler 当前的默认 follow-up 行为保持克制：只在 `payload.stimulus` 显式提供合法 `Stimulus` 时重新发出 `stimulus.received`，不在 scheduler 内部发明复杂主动行为策略。

---

## 6.7 `Stimulus`
表示系统感知到的刺激，是当前阶段最关键的主链输入对象。

当前正式方向已经包含：
- 核心身份字段
- 作用域与参与者字段
- 平台结构事实字段
- 结构化特征字段
- `payload`
- `metadata`

---

## 6.8 `DialogueTask`
表示从 behavior / planner 流向 dialogue 层的正式任务对象。

当前用于承接：
- `ResponsePlan`
- `behavior.instruction`
- `dialogue.task.created`
- `dialogue.generation.requested`
- `dialogue.started`
- `dialogue.completed`
- `dialogue.failed`

---

## 6.9 `DialogueResult`
表示 dialogue 层返回的正式结果对象。
用于后续 sender / observability / trace 的统一输出。

---

## 6.10 `MemoryEntry`

表示生命体长期记忆事实条目。
Memory System v1 已进入 `core` 正式契约层，用于承接 behavior execution side-effect、后续 cognition / dialogue context enrichment 与长期事实源落地。

当前核心对象包括：

### `MemoryKind`

表示 memory 类型，当前支持：

- `episodic`
- `semantic`
- `preference`
- `relationship`
- `self`
- `task`
- `system`

### `MemoryScope`

表示 memory 作用域，当前支持：

- `life`
- `actor`
- `habitat`
- `thread`
- `projection`
- `global`

### `MemoryOwnerType`

表示 memory 归属主体类型，当前支持：

- `life`
- `actor`
- `habitat`
- `thread`
- `projection`
- `event`
- `global`

它用于区分“这条记忆应挂在哪个长期事实主体下”，不等同于旧版 `scope`。`scope` 仍用于表达检索与上下文注入的作用域，`ownerType / ownerId` 则用于表达记忆归属与路由结果。

### `MemoryVisibility`

表示 memory 可见性，当前支持：

- `private`
- `shared`
- `habitat`
- `global`

### `MemoryRelationRole`

表示 memory 与其他主体之间的关系角色，当前支持：

- `subject`
- `participant`
- `mentioned`
- `observer`
- `location`
- `source`
- `shared-with`

### `MemoryRelation`

表示一条 memory 与 actor / habitat / thread / event 等主体之间的结构化关系，当前包含：

- `targetType`
- `targetId`
- `role`
- `confidence`
- `metadata`

### `MemoryAttributionMode`

表示 memory attribution 使用的归因模式，当前支持：

- `deterministic`
- `ai-assisted`

### `MemoryStatus`

表示 memory 生命周期状态，当前支持：

- `active`
- `archived`
- `suppressed`
- `deleted`

### `MemorySource`

表示 memory 来源追踪，当前可承接：

- `stimulusId`
- `behaviorPlanId`
- `executionPlanId`
- `executionActionId`
- `dialogueTaskId`
- `outputId`
- `event`
- `createdBy`

### `MemoryEntry`

表示一条正式长期记忆，当前包含：

- `id`
- `lifeId`
- `scope`
- `kind`
- `status`
- `content`
- `summary`
- `tags`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `ownerType`
- `ownerId`
- `relations`
- `visibility`
- `eventId`
- `eventType`
- `source`
- `importance`
- `confidence`
- `decay`
- `createdAt`
- `updatedAt`
- `lastAccessedAt`
- `accessCount`
- `metadata`

### `MemoryUpdateRequest`

表示 execution layer 或其他能力层提出的记忆写入请求。
当前 behavior execution 的 `memory-update` action 会发出 `behavior.memory.update.requested`，由 runtime 默认 `MemoryService` 消费。

除基础写入字段外，`MemoryUpdateRequest` 也支持 attribution / routing 相关字段：

- `ownerType`
- `ownerId`
- `relations`
- `visibility`
- `eventId`
- `eventType`
- `attributionMode`
- `skipAttribution`

当请求没有显式提供 `ownerType / ownerId` 且没有设置 `skipAttribution` 时，runtime 默认 memory service 会通过 `MemoryAttributor` 进行归因补全。

### `MemoryAttributor` / `MemoryAttributionResult`

表示 memory 写入前的 attribution 策略边界。

`MemoryAttributor` 当前包含：

- `attribute(request)`

`MemoryAttributionResult` 当前包含：

- `mode`
- `requests`
- `diagnostics`

该抽象允许一条原始 memory update request 被归因为一条或多条正式写入请求，例如：

- 个人偏好路由为 actor private memory
- 线程内事件路由为 thread shared memory
- habitat 公共事实路由为 habitat memory
- news / public metadata 路由为 global semantic memory
- AI assisted attribution 将一条输入拆成 actor + habitat + event 等多条记忆

runtime 当前提供 `DeterministicMemoryAttributor` 作为默认非 AI 归因实现，并允许通过 `createDefaultRuntime({ memoryAttributor })` 注入自定义归因器。

### `MemoryRelevanceSelectionRequest` / `MemoryRelevanceSelector`

表示 memory 检索侧的候选相关性选择请求、结果与策略边界。

Memory Relevance Selection v1 用于在结构化召回候选之后，对候选 memory 做最终选择、重排与解释。它的设计原则是：LLM 不直接查询 repository，只能在 rule-based provider 已召回的候选集合中选择。

当前核心对象包括：

- `MemoryRelevanceSelectionRequest`
  - `contextRequest`
  - `candidates`
  - `content`
  - `limit`
  - `mode`
  - `metadata`
- `MemoryRelevanceSelectionResult`
  - `items`
  - `selectedIds`
  - `rejectedIds`
  - `reason`
  - `usedAI`
  - `fallbackReason`
  - `metadata`
- `MemoryRelevanceSelector`
  - `select(request)`

runtime 当前提供：

- `RuleBasedMemoryRelevanceSelector`
  - 按候选 `score` 排序并截断
  - 默认 `usedAI: false`
- `AiAssistedMemoryRelevanceSelector`
  - 使用 `BrainService` 的 `memory-relevance-selection` capability 请求 JSON 选择结果
  - 根据模型返回的 `selectedIds / reasonById` 重排与解释候选
  - AI 失败、JSON 解析失败或无合法 selectedIds 时 fallback 到 rule-based selector

相关事件：

- `memory.relevance.selection.requested`
- `memory.relevance.selection.completed`
- `memory.relevance.selection.failed`
- `memory.relevance.selection.fallback`

### `MemoryContextRequest` / `MemoryContextPack`

表示 memory 检索侧的上下文构建请求与结果。

Memory Context Injection v1 用于把长期记忆从“可查询事实源”推进为“可被 dialogue / brain 主链消费的上下文包”。它不直接暴露裸 `MemoryEntry[]` 给 brain，而是输出带评分、命中来源和原因的 context item。

当前核心对象包括：

### `MemoryContextMode`

表示 context 构建模式，当前支持：

- `rule-based`
- `ai-assisted`

当前 runtime 默认实现仍可保持为 `rule-based`；当注入 `MemoryRelevanceSelector` 且 selector 使用 AI 成功时，context pack 可标记为 `ai-assisted`。

### `MemoryContextMatchSource`

表示 memory context item 的命中来源，当前支持：

- `actor`
- `thread`
- `habitat`
- `global`
- `relation`
- `text`
- `importance`
- `recency`

### `MemoryContextItem`

表示一条被选入上下文的 memory，当前包含：

- `entry`
- `score`
- `reason`
- `matchedBy`
- `metadata`

### `MemoryContextRequest`

表示一次上下文构建请求，当前包含：

- `lifeId`
- `stimulusId`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `content`
- `query`
- `limit`
- `mode`
- `includeGlobal`
- `includeHabitat`
- `metadata`

### `MemoryContextPack`

表示一次上下文构建结果，当前包含：

- `lifeId`
- `stimulusId`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `mode`
- `items`
- `totalCandidates`
- `createdAt`
- `metadata`

### `MemoryContextProvider`

表示 memory context 构建策略边界，当前包含：

- `buildContext(request)`

runtime 当前提供 `RuleBasedMemoryContextProvider`，它会按 actor private、thread shared、habitat、global、relation 与 text 多路召回候选记忆，去重后按 importance / owner / relation / text overlap / recency 打分排序，并输出 `MemoryContextPack`。该 provider 当前支持注入 `MemoryRelevanceSelector`，用于在 scored candidates 之后接管最终上下文选择。

dialogue 当前可通过 runtime 注入的 `memoryContextProvider` 在构造 `BrainRequest` 前构建 memory context；brain 会把 `BrainRequest.memoryContext` 注入 system message 的长期记忆上下文 section。

### `MemoryQuery` / `MemorySearchResult`

表示 memory 检索请求与结果。当前检索维度包括：

- `lifeId`
- `actorId`
- `habitatId`
- `threadId`
- `projectionId`
- `stimulusId`
- `scope`
- `kind`
- `status`
- `ownerType`
- `ownerId`
- `relationTargetType`
- `relationTargetId`
- `relationRole`
- `visibility`
- `eventId`
- `eventType`
- `tags`
- `text`
- `minImportance`
- `minConfidence`
- `createdAfter / createdBefore`
- `limit / offset`
- `orderBy / order`

### `MemoryConsolidationRequest` / `MemoryConsolidationResult`

表示记忆整理请求与结果。
当前 runtime 默认实现提供规则版 consolidation：合并同一 life / actor / kind / tags 下的 active memories，生成 consolidated memory，并归档旧条目。

### `MemoryRepository`

表示长期记忆事实源抽象，当前包含：

- `getById(id)`
- `save(entry)`
- `update(id, patch)`
- `remove(id)`
- `query(query)`
- `listByLifeId(lifeId, options)`
- `listByStimulusId(stimulusId)`

### `MemoryService`

表示 memory 策略边界，当前包含：

- `update(request)`
- `retrieve(query)`
- `consolidate(request)`

注意：`core` 只定义 memory 契约，不实现具体存储。
runtime 当前提供默认内存实现：

- `MemoryMemoryRepository`
- `DefaultMemoryService`
- `DeterministicMemoryAttributor`
- `RuleBasedMemoryContextProvider`
- `RuleBasedMemoryRelevanceSelector`
- `AiAssistedMemoryRelevanceSelector`

---

## 6.11 `BehaviorExecutionPlan`

表示 behavior 层选中行为后交给 runtime 执行层的正式执行计划。

当前 behavior execution layer 用于把 `ResponsePlan` 中的 dialogue / memory / bond / homeostasis / follow-up 等 flags 展开为可观测、可测试、可失败治理的执行动作集合。

核心对象包括：

### `BehaviorExecutionAction`

表示单个执行动作，当前支持：

- `dialogue`
- `schedule-followup`
- `memory-update`
- `bond-update`
- `homeostasis-update`
- `emit-event`
- `noop`

每个 action 具有：

- `id`
- `type`
- `priority`
- `payload`
- `metadata`

### `BehaviorExecutionPlan`

表示一次行为执行计划，当前包含：

- `id`
- `stimulusId`
- `lifeId`
- `habitatId`
- `source`
- `actions`
- `createdAt`
- `metadata`

behavior 包当前提供 `createBehaviorExecutionPlan()`，把 `ResponsePlan` flags 展开为正式 actions。

### `BehaviorExecutionResult`

表示 runtime execution service 执行计划后的结果，当前包含：

- `planId`
- `status`
- `actions`
- `startedAt`
- `completedAt`
- `metadata`

runtime 当前提供 `DefaultBehaviorExecutionService`，统一承接：

- dialogue action：调用 `DialogueService`
- schedule-followup action：通过 scheduler 创建 `ScheduledTask`
- memory / bond / homeostasis action：发出 request event，不在 execution 层发明具体长期算法
- emit-event / noop action：作为显式副作用或空操作

---

## 6.12 `BehaviorCandidate`
表示候选行为。
当前已进入 `core` 正式类型层，用于承接 behavior candidate 生成、排序与观测。

当前 behavior 层已经实际生成 `BehaviorCandidate[]`，并通过 `behavior.candidates.generated` 事件暴露给 observatory 与后续 planner 深化使用。
候选行为当前承接以下关键信息：

- `id`
- `type`
- `scope`
- `sourceStimulusIds`
- `priority`
- `confidence`
- `reason`
- `shouldEnterDialogue`
- `shouldUpdateMemory`
- `shouldUpdateBond`
- `shouldUpdateHomeostasis`
- `shouldScheduleFollowup`
- `metadata`

---

## 6.13 `BehaviorDecision`
表示最终选中的行为决定。
当前已进入 `core` 正式类型层，用于承接最终行为选择、候选列表、信号与选择理由。

当前 behavior 层已经从单一路由决策升级为：

```txt
StimulusSignal
  -> ProgramRoutingDecision
  -> BehaviorCandidate[]
  -> BehaviorDecision
  -> ResponsePlan
  -> BehaviorExecutionInstruction
```

其中 `behavior.selected` 仍保持旧消费方兼容，同时额外携带 `candidates` 与 `behaviorDecision`，便于后续 behavior planner / observatory / scheduler 继续深化。

---

## 6.14 Life State Context 对象

当前生命状态层第一轮主链接入已经形成以下正式契约对象：

### `PerceptionResult`
表示 perception 层对单个 `Stimulus` 的感知分析结果，当前包含：

- `stimulusId`
- `context`
  - `stimulusId`
  - `habitatId`
  - `actorId`
  - `type`
  - `tokenCount`
- `intent`
- `entities`
- `sentiment`
- `analyzedAt`
- `metadata`（可选，记录分析模式与 AI enhanced 信息）

它通过 `perception.completed` 进入事件总线，供 behavior planning 与 cognition 消费。

### `HomeostasisState`
表示某个 life 当前的稳态状态，当前包含：

- `lifeInstanceId`
- `timestamp`
- `energy`
- `mood`
- `sociability`
- `curiosity`
- `responseThreshold`
- `metadata`

### `HomeostasisDelta`
表示一次稳态更新的变化量，当前包含：

- `lifeInstanceId`
- `energy`
- `mood`
- `sociability`
- `curiosity`
- `responseThreshold`
- `reason`

### `HomeostasisUpdateRequest`

表示 execution layer 或其他能力层提出的稳态写入请求。
当前 behavior execution 的 `homeostasis-update` action 会发出 `behavior.homeostasis.update.requested`，由 runtime 默认 `HomeostasisService` 消费。

### `HomeostasisUpdateResult`

表示一次稳态写入结果，当前包含：

- `requestId`
- `state`
- `delta`
- `updated`
- `reason`
- `metadata`

### `HomeostasisService`

表示 homeostasis 写入与查询策略边界，当前包含：

- `getState(lifeId)`
- `update(request)`

注意：`core` 只定义 homeostasis 契约，不实现具体存储。
runtime 当前提供默认实现：

- `DefaultHomeostasisService`

`DefaultHomeostasisService` 通过 runtime `LifeStateRepository<HomeostasisState>` 写入状态，并消费 `behavior.homeostasis.update.requested`。写入成功后发出 `homeostasis.updated`，写入失败时发出 `homeostasis.update.failed`。

`HomeostasisDelta` 通过 `homeostasis.updated` 进入事件总线，供 behavior 按 `lifeId` 缓存并调整行为倾向。

### `CognitionContext`
表示 cognition 层推理时的完整上下文，当前包含：

- `stimulusId`
- `lifeId`
- `habitatId`
- `actorId`
- `threadId`
- `scopeKey`
- `stimulus`
- `persona`
- `perception`（消费 perception.completed 的结果）
- `homeostasis`（消费 homeostasis.updated 的状态）
- `recentConversation`
- `metadata`

### `CognitionResult`
表示 cognition 层对单个 routed life 的认知推理结果，当前包含：

- `stimulusId`
- `lifeId`
- `scopeKey`
- `summary`
- `salience`
- `continuity`
- `shouldEnterBehavior`
- `reason`（动态可解释字符串，包含触发信号列表）
- `createdAt`
- `metadata`（记录分析模式、perception/homeostasis 消费信息、AI enhanced 信息）

它通过 `cognition.completed` 进入事件总线，其中 `shouldEnterBehavior` 可作为 behavior planning 的门控信号。

cognition 当前消费以下上游信号影响 salience：
- perception intent（share_feeling / ask_opinion / command / ask_fact）
- perception sentiment（negative / positive / high confidence）
- homeostasis 状态（sociability / energy / curiosity / mood）
- persona traits（温柔/好奇/活泼/沉稳）

---

## 6.15 Observatory Trace 对象
当前 observatory 层已形成主链 trace 对象：

- `ObservedEventRecord`
- `StimulusTrace`
- `ObservatorySnapshot`

这些对象当前定义在 `@elysia-ai/observatory` 内部，语义上对应 `core` 已有的 `TraceRepository` 抽象方向。
当前阶段暂不把具体观测实现放入 `core`，以保持 `core` 只定义公共协议与长期抽象，不承担观测存储实现。

`ObservedEventRecord` 当前用于承接：

- `event`
- `timestamp`
- `stimulusId`
- `outputId`
- `taskId`
- `lifeId`
- `habitatId`
- `scopeType`
- `status`
- `summary`
- `metadata`


## 7. Schema 设计要求

每个正式核心对象都应有对应 schema。

当前要求：

- schema 与 type 语义保持同步
- 不为了灵活性牺牲可读性
- 不在 schema 中提前塞入大量未落地字段
- 不写与核心语义无关的复杂 transform

当前已经较明确形成 schema 的重点对象包括：

- `LifeInstance`
- `Habitat`
- `Bond`
- `Thread`
- `Projection`
- `Stimulus`

---

## 8. Event Bus 抽象

`core` 定义事件总线接口与事件类型映射，但不实现具体宿主行为。

## 8.1 当前正式事件命名风格
统一采用：

```txt
domain.action
```

例如：
- `stimulus.received`
- `behavior.selected`
- `dialogue.started`
- `dialogue.completed`
- `brain.requested`
- `gateway.responded`

---

## 8.2 当前主链正式事件
当前正式主链事件已包括：

### runtime
- `runtime.starting`
- `runtime.started`
- `runtime.stopping`
- `runtime.stopped`

### life
- `life.loaded`

### stimulus / 状态
- `stimulus.received`
- `projection.routed`
- `projection.rule.updated`
- `projection.rule.disabled`
- `projection.rule.removed`
- `scheduler.task.created`
- `scheduler.task.started`
- `scheduler.task.completed`
- `scheduler.task.failed`
- `scheduler.task.cancelled`
- `scheduler.task.expired`
- `perception.completed`
  - payload: `{ stimulusId, result: PerceptionResult }`
- `homeostasis.updated`
  - payload: `{ lifeInstanceId, state: HomeostasisState, delta: HomeostasisDelta, requestId?, result?, planId?, actionId? }`
- `homeostasis.update.failed`
  - payload: `{ requestId, request: HomeostasisUpdateRequest, error, planId?, actionId? }`

### cognition
- `cognition.reasoning`
- `cognition.completed`
  - payload: `CognitionResult`

### behavior
- `behavior.candidates.generated`
- `behavior.selected`
- `behavior.instruction`
- `behavior.execution.started`
- `behavior.execution.action.started`
- `behavior.execution.action.completed`
- `behavior.execution.action.failed`
- `behavior.execution.completed`
- `behavior.execution.failed`
- `behavior.followup.scheduled`
- `behavior.memory.update.requested`
- `behavior.bond.update.requested`
- `behavior.homeostasis.update.requested`

### memory
- `memory.created`
- `memory.updated`
- `memory.update.failed`
- `memory.retrieved`
- `memory.retrieve.failed`
- `memory.context.requested`
- `memory.context.selected`
- `memory.context.failed`
- `memory.relevance.selection.requested`
- `memory.relevance.selection.completed`
- `memory.relevance.selection.failed`
- `memory.relevance.selection.fallback`
- `memory.consolidation.requested`
- `memory.consolidated`
- `memory.consolidation.failed`

### bond
- `bond.created`
- `bond.updated`
- `bond.update.failed`
- `bond.retrieved`
- `bond.retrieve.failed`
- `bond.context.requested`
- `bond.context.selected`
- `bond.context.failed`
- `bond.relevance.selection.requested`
- `bond.relevance.selection.completed`
- `bond.relevance.selection.failed`
- `bond.relevance.selection.fallback`

### dialogue
- `dialogue.task.created`
- `dialogue.generation.requested`
- `dialogue.started`
- `dialogue.generated`
- `dialogue.output.created`
- `dialogue.completed`
- `dialogue.failed`

### brain
- `brain.requested`
- `brain.completed`
- `brain.failed`

### gateway
- `gateway.requested`
- `gateway.responded`
- `gateway.failed`

### sender / body
- `sender.started`
- `sender.completed`
- `sender.failed`
- `body.message.sent`
- `body.message.failed`

---

## 9. Repository 抽象

当前 `core` 里只定义 repository 接口，不实现具体 Mongo / Redis 逻辑。
Observatory 当前使用内存 `ObservatoryStore` 承接 recent events 与 stimulus trace，后续如果进入持久化阶段，应与 `TraceRepository` 的长期事实源边界对齐，而不是让 `core` 依赖 observatory 实现。

`LifeStateRepository<TState>` 当前是生命状态事实源的正式抽象，已被 runtime 的 `stateRepository` 挂载点消费。
runtime 当前提供：
- `MemoryStateRepository<TState>`：默认内存实现，用于测试、开发和无外部依赖场景
- `MongoStateRepository<TState>`：Mongo-compatible 起步实现，当前位于 `packages/elysia-ai-runtime/src/store/mongo-state-repository.ts`，用于承接 MongoDB 长期事实源落地
- `createRuntimeStateRepository()`：runtime 插件层仓储装配函数，支持通过 `stateRepository.type` 选择 `memory / mongo`，并负责 Mongo 连接、collection 选择、索引初始化、dispose 关闭与失败 fallback / fail-fast 策略

注意：`MongoStateRepository` 与 `createRuntimeStateRepository()` 不属于 `core` 实现。
`core` 仍只拥有 `LifeStateRepository` 抽象，保持“不在 core 中写 MongoDB 具体实现”的边界。

### 当前已正式进入契约层的 repository
- `LifeRepository`
- `ProjectionRuleRepository`
- `ScheduledTaskRepository`
- `StateRepository`
- `StimulusRepository`
- `BondRepository`
- `TraceRepository`
- `MemoryRepository`

### 当前仍可继续扩展但不是主优先级
- `ProjectionRepository`
- `ThreadRepository`
- `HabitatRepository`

---

## 10. Dialogue / Brain / Model Gateway 抽象

这是当前阶段的主链契约核心。

---

## 10.1 `Dialogue`
当前 `core` 中已正式补入：

- `DialogueTask`
- `DialogueResult`
- `DialogueService`

它们的职责是：

- 承接 behavior 通过 `behavior.instruction` 产出的正式对话任务
- 定义 dialogue 层对外的稳定输入输出结构
- 通过 `dialogue.output.created` 为 sender / observability / trace 提供统一输出对象

---

## 10.2 `Brain`
当前 `core` 中已正式补入：

- `BrainRequest`
- `BrainResponse`
- `BrainCapability`
- `BrainService`

它负责：

- 统一认知请求抽象
- 统一认知响应抽象
- 对上层暴露统一能力接口

它回答的是：

> “我要问什么”。

### 10.2.1 Prompt Composition Contract

当前正式 prompt 组合顺序为：

1. `BrainRequest.systemPrompt`
2. persona system prompt（由 `Persona.systemPrompt + traits + tone` 组成）
3. brain config fallback system prompt
4. `MemoryContextPack` 渲染出的 long-term memory context
5. `BondContextPack` 渲染出的 relationship context
6. context budget planner 的最终截断治理

其中 `BrainRequest.systemPrompt` 具有最高优先级；没有 request override 时，persona system prompt 优先于 config fallback。memory / bond context 只追加为上下文 section，不允许覆盖 persona，不允许重新引入被 persona 替代的 config fallback，也不允许要求模型向用户泄露内部 score、reason 或 relationship metrics。

### 10.2.2 Dialogue Task 边界

同一 `behavior.instruction` 的主回复链路只应产生一个进入 `dialogue.generation.requested` 的主 `DialogueTask`。Behavior Execution Layer 可以为同一 plan 发出带 `metadata.behaviorExecution === true` 的执行侧 `dialogue.task.created` 事件，用于观测和编排追踪；该事件不等价于一次模型生成请求。

---

## 10.3 `Model Gateway`
当前 `core` 中已正式补入：

- `ModelGatewayRequest`
- `ModelGatewayResponse`
- `ProviderDescriptor`
- `RoutingResult`
- `ModelUsage`
- `ModelGatewayService`

它负责：

- provider / endpoint / routing 抽象
- 请求 / 响应的统一出口
- usage / finishReason 等模型调用结果的标准化

它回答的是：

> “这个请求怎么发给哪个模型”。

---

## 11. 当前推荐目录结构

当前 `core` 的真实目录应理解为：

```txt
packages/@elysia-ai/core/src/
  index.ts

  types/
    life.ts
    habitat.ts
    bond.ts
    thread.ts
    stimulus.ts
    dialogue.ts
    memory.ts
    behavior-execution.ts
    perception.ts
    homeostasis.ts
    cognition.ts
    scheduler.ts

  schemas/
    life.ts
    habitat.ts
    bond.ts
    thread.ts
    stimulus.ts

  bus/
    event-bus.ts
    event-map.ts
    memory-event-bus.ts

  repositories/
    bond.ts
    life.ts
    projection-rule.ts
    scheduled-task.ts
    state.ts
    stimulus.ts
    trace.ts

  dialogue/
    dialogue.ts

  brain/
    brain.ts
    model-gateway.ts

  errors/
    index.ts

  plugin/
    index.ts
    manifest.ts
    pipeline-context.ts
    hooks.ts
```

---

## 12. 当前阶段验收标准

当当前阶段 `core` 收口完成时，应满足：

1. 核心对象已稳定
2. `Stimulus` 已成为正式输入对象
3. `CoreEventMap` 已形成主链事件基线
4. repository 抽象已补齐当前主链所需最小集合
5. `Dialogue / Brain / Model Gateway` 抽象接口已形成
6. 主链事件已覆盖 behavior / dialogue / brain / gateway / sender / body
7. observatory 可基于 `CoreEventMap` 做旁路 trace 聚合
8. `src/index.ts` 已统一导出
9. 其他包可以直接依赖 `@elysia-ai/core` 继续推进实现
10. 生命状态层的正式结果对象已进入 `core`，上层包不应反向依赖 perception / homeostasis / cognition 的私有类型
11. Behavior execution layer 的执行计划、执行动作、执行结果与 request event 已进入 `core`，runtime 负责执行编排，长期事实源消费方由对应上层能力包实现
12. Memory System v1 的 entry / query / update / consolidation / attribution / context / repository / service 契约已进入 `core`，runtime 可提供默认实现，但 `core` 不承担具体存储
13. Bond System v1 的 bond / metrics / query / update / repository / service / context / relevance selection 契约已进入 `core`，runtime 可提供默认实现，但 `core` 不承担具体存储
14. Homeostasis Request Consumer v1 的 update request / update result / service 契约已进入 `core`，runtime 可提供默认实现并消费 execution layer 的 homeostasis request，但 `core` 不承担具体存储

---

## 13. 当前阶段禁止事项

### 禁止项 1
禁止在 `core` 中写 MongoDB 具体实现。

### 禁止项 2
禁止在 `core` 中写 Koishi 平台逻辑。

### 禁止项 3
禁止在 `core` 中写 OpenAI / Gemini / Claude 的具体请求代码。

### 禁止项 4
禁止把大量工具函数塞进 `core`，把它写成“大杂烩工具库”。

### 禁止项 5
禁止让 `core` 依赖：
- `elysia-ai-runtime`
- `elysia-ai-body`
- `@elysia-ai/cognition`
- `@elysia-ai/behavior`
- 其他上层包

### 禁止项 6
禁止把 `core` 当成 Koishi 宿主入口包来设计。

---

## 14. 一句话总结

`@elysia-ai/core` 当前阶段的唯一目标是：

> **把 Elysia A.I. 的公共语言、运行时校验模型、主链事件和基础抽象接口定义清楚，并作为宿主入口包与内部能力包共同依赖的正式协议层稳定下来。**
