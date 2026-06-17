# Elysia A.I. ↔ Koishi 模块映射表

本文档基于 Koishi 插件 / service / lifecycle / package metadata 机制，定义 Elysia A.I. 在 Koishi monorepo 中的模块落位。

## 1. 分类定义

| 分类 | 含义 | Koishi Loader 配置 | 注册 service |
| --- | --- | --- | --- |
| Kernel Plugin | 系统内核插件，提供运行时基础设施 | 是 | 是 |
| Adapter Plugin | 外部平台/消息适配插件 | 是 | 可选 |
| Capability Plugin | 可配置能力插件 | 是 | 通常是 |
| Runtime Subservice | runtime 内部 kernel 子系统 | 随 runtime | 可通过 runtime 暴露 |
| Pure Library | 类型、契约、工具库 | 否 | 否 |

## 2. 模块定位

| 模块 | 当前包 | 定位 | 配置归属 | Service | 说明 |
| --- | --- | --- | --- | --- | --- |
| runtime | `koishi-plugin-elysia-ai-runtime` | Kernel Plugin | runtime | `elysia.runtime` / 兼容 `elysia-ai-runtime` | lifecycle、event bus、life/habitat/persona registry、scheduler/projection/state repository wiring |
| body | `koishi-plugin-elysia-ai-body` | Adapter Plugin | body | 可选 `elysia.body` | Koishi session/message 与 Elysia stimulus/output 适配 |
| memory | `@elysia-ai/memory` | Capability Plugin | memory | `elysia.memory` | memory repository、service、attributor、context provider、relevance selector、consolidation |
| bond | `@elysia-ai/bond` | Capability Plugin | bond | `elysia.bond` | bond repository、service、context provider、relevance selector |
| model-gateway | `@elysia-ai/model-gateway` | Capability Plugin | model-gateway | `elysia.modelGateway` | provider、slot、retry、fallback、health、circuit breaker |
| brain | `@elysia-ai/brain` | Capability Plugin | brain | `elysia.brain` | prompt composition、context budget、model-gateway 调用 |
| dialogue | `@elysia-ai/dialogue` | Capability Plugin | dialogue | `elysia.dialogue` | DialogueTask 执行、conversation context、memory/bond context、brain 调用 |
| behavior | `@elysia-ai/behavior` | Capability Plugin | behavior | `elysia.behavior` 或事件消费者 | 行为规划、execution plan、instruction、memory/bond update request |
| perception | `@elysia-ai/perception` | Capability Plugin | perception | `elysia.perception` | Stimulus 解释，AI enhanced perception 开关 |
| cognition | `@elysia-ai/cognition` | Capability Plugin | cognition | `elysia.cognition` | routed life reasoning、behavior gating |
| homeostasis | `@elysia-ai/homeostasis` | Capability Plugin | homeostasis | `elysia.homeostasis` | 生命状态 tick 与 state repository 写回 |
| persona | `@elysia-ai/persona` | Capability Plugin | persona | `elysia.persona` | persona registry / loading / prompt context provider |
| observatory | `@elysia-ai/observatory` | Capability Plugin | observatory | `elysia.observatory` | trace、recent events、gateway analytics、debug query |
| scheduler | runtime 内部 | Runtime Subservice | runtime | `elysia.scheduler`（后续） | follow-up、retry、delayed stimulus |
| projection | runtime 内部 | Runtime Subservice | runtime | `elysia.projection`（后续） | life routing、projection rule repository |
| core | `@elysia-ai/core` | Pure Library | 无 | 无 | 类型、事件、契约、repository interface |
| shared | `@elysia-ai/shared` | Pure Library | 无 | 无 | logger、AI utils、bounded cache、persona/relevance utilities |

## 3. 推荐加载顺序

1. runtime
2. observatory
3. model-gateway
4. brain
5. memory
6. bond
7. persona
8. perception
9. homeostasis
10. cognition
11. behavior
12. dialogue
13. body

关键规则：

- runtime 必须先提供 kernel event bus 与 registry。
- observatory 应尽早加载，以便订阅完整事件链。
- model-gateway 必须先于 brain；brain 必须先于 dialogue。
- memory/bond 应先于 dialogue 加载，dialogue 通过 `elysia.memory` / `elysia.bond` 获取 context provider。
- memory/bond 缺失时，behavior 仍可发出 side-effect request；无人消费不应阻断主回复链路。

## 4. 依赖注入建议

| 插件 | 必需依赖 | 可选依赖 |
| --- | --- | --- |
| observatory | runtime | 无 |
| model-gateway | runtime | observatory |
| brain | runtime、model-gateway | persona、observatory |
| memory | runtime | brain、observatory |
| bond | runtime | brain、observatory |
| dialogue | runtime、brain | memory、bond、observatory |
| behavior | runtime | perception、cognition、homeostasis、persona、memory、bond |
| perception | runtime | brain |
| cognition | runtime | perception、homeostasis、brain |
| homeostasis | runtime | observatory |
| persona | runtime | observatory |
| body | runtime | dialogue、observatory |

## 5. Package metadata 规则

Capability Plugin 应具备：

- `peerDependencies.koishi`
- `koishi.description`
- 提供 service 时声明 `koishi.service.implements`
- `main/types/exports` 指向真实构建产物
- `files` 覆盖 `lib` 与必要源码或声明

Pure Library 不应具备 `koishi` 插件 metadata。

## 6. 当前架构决议

1. `runtime` 是 kernel，不再拥有 memory/bond 默认实现。
2. `memory` 与 `bond` 已拆为正式 capability plugins。
3. `runtime.memoryService`、`runtime.memoryContextProvider`、`runtime.bondService`、`runtime.bondContextProvider` 仅作为迁移期 deprecated 兼容字段，由插件安装后回填。
4. 新代码必须优先使用 `ctx['elysia.memory']` / `ctx['elysia.bond']` 或后续正式 service accessor。
5. `core` / `shared` 保持 pure library，不进入 Koishi 插件加载面。
## Phase 36 Update
- Formal Koishi service names are now the primary API: `elysia.runtime`, `elysia.modelGateway`, `elysia.brain`, `elysia.dialogue`, `elysia.behavior`, `elysia.perception`, `elysia.cognition`, `elysia.homeostasis`, `elysia.persona`, `elysia.observatory`, `elysia.memory`, `elysia.bond`, `elysia.body`.
- Legacy `elysia-ai-*` aliases remain for migration, but new code and tests should prefer the formal names.
- Capability plugins now declare `koishi.description` and `koishi.service.implements` in package metadata.
- Recommended load order: `runtime` -> `observatory` -> `model-gateway` -> `brain` -> `memory` / `bond` -> `persona` / `perception` / `homeostasis` / `cognition` -> `behavior` -> `dialogue` -> `body`.
- Missing required dependencies should fail fast without partial initialization; optional capability plugins may degrade gracefully.

## Phase 37 Update: Multi-Plugin Koishi Composition
- Elysia A.I. is delivered as multiple independently loadable Koishi plugins, not as a single aggregator plugin.
- Recommended minimal dialogue chain: `runtime -> model-gateway -> brain -> behavior -> dialogue -> body`.
- Recommended full life chain: minimal chain plus `observatory`, `memory`, `bond`, `persona`, `perception`, `homeostasis`, and `cognition`.
- Recommended debug chain: `runtime -> observatory -> model-gateway -> brain -> dialogue`.
- Capability plugins own their own `Config` schema and expose typed `elysia.*` services; `core` and `shared` remain pure libraries.

## Phase 39 module boundary

- `packages/elysia-ai-*`: Koishi Loader-facing plugin packages with `name`, `Config`, `apply`, package metadata, and service registration.
- `packages/@elysia-ai/*`: internal implementation libraries with service classes, repositories, selectors, providers, types, and `applyInternal` for wrapper delegation.
- New tests must use top-level plugin packages for Koishi composition and dependency behavior. Internal packages are reserved for pure implementation tests.

## Phase 40 factory boundary

- Koishi imports are allowed in top-level plugin packages and runtime/body only.
- Capability implementation packages under `packages/@elysia-ai/*` expose factories such as `createMemoryPluginRuntime` and do not import `koishi`.
- Top-level plugins call the factories, own Koishi schema, and keep canonical/legacy service registration behavior.
## Phase 42 Delivery Mapping Update

Phase 42 fixes the delivery boundary as a testable contract:

| Top-level Koishi plugin | Internal implementation package | Canonical service | Required services | Optional services | Config owner |
| --- | --- | --- | --- | --- | --- |
| `koishi-plugin-elysia-ai-runtime` | `@elysia-ai/core`, `@elysia-ai/shared` | `elysia.runtime` | none | none | runtime |
| `koishi-plugin-elysia-ai-observatory` | `@elysia-ai/observatory` | `elysia.observatory` | `elysia.runtime` | none | observatory |
| `koishi-plugin-elysia-ai-model-gateway` | `@elysia-ai/model-gateway` | `elysia.modelGateway` | `elysia.runtime` | none | model-gateway |
| `koishi-plugin-elysia-ai-brain` | `@elysia-ai/brain` | `elysia.brain` | `elysia.runtime`, `elysia.modelGateway` | none | brain |
| `koishi-plugin-elysia-ai-memory` | `@elysia-ai/memory` | `elysia.memory` | `elysia.runtime` | none | memory |
| `koishi-plugin-elysia-ai-bond` | `@elysia-ai/bond` | `elysia.bond` | `elysia.runtime` | none | bond |
| `koishi-plugin-elysia-ai-persona` | `@elysia-ai/persona` | `elysia.persona` | `elysia.runtime` | none | persona |
| `koishi-plugin-elysia-ai-perception` | `@elysia-ai/perception` | `elysia.perception` | `elysia.runtime` | `elysia.brain` | perception |
| `koishi-plugin-elysia-ai-homeostasis` | `@elysia-ai/homeostasis` | `elysia.homeostasis` | `elysia.runtime` | none | homeostasis |
| `koishi-plugin-elysia-ai-cognition` | `@elysia-ai/cognition` | `elysia.cognition` | `elysia.runtime` | `elysia.brain` | cognition |
| `koishi-plugin-elysia-ai-behavior` | `@elysia-ai/behavior` | `elysia.behavior` | `elysia.runtime` | none | behavior |
| `koishi-plugin-elysia-ai-dialogue` | `@elysia-ai/dialogue` | `elysia.dialogue` | `elysia.runtime`, `elysia.brain` | `elysia.memory`, `elysia.bond` | dialogue |
| `koishi-plugin-elysia-ai-body` | top-level adapter implementation | `elysia.body` | `elysia.runtime`, `elysia.dialogue` | none | body |

Rules:
- Only `packages/elysia-ai-*` packages are Koishi Loader-facing plugins.
- `packages/@elysia-ai/*` packages are implementation libraries and expose factory/class/type exports only.
- Canonical collaboration uses `elysia.*`; `elysia-ai-*` aliases are compatibility registrations owned by top-level plugins.
- Recommended load order remains: runtime ? observatory ? model-gateway ? brain ? memory/bond ? persona/perception/homeostasis/cognition ? behavior ? dialogue ? body.
## Phase 43 Production Repository / Provider Mapping

Phase 43 adds production-facing provider configuration without changing the multi-plugin boundary:

| Plugin | New production owner | Default behavior | Production extension | Failure rule |
| --- | --- | --- | --- | --- |
| `koishi-plugin-elysia-ai-memory` | Memory repository provider | In-memory repository | Injected Mongo-compatible `MemoryRepository` factory | `repository.type = mongo` without `repositoryFactory` fails fast |
| `koishi-plugin-elysia-ai-bond` | Bond repository provider | In-memory repository | Injected Mongo-compatible `BondRepository` factory | `repository.type = mongo` without `repositoryFactory` fails fast |
| `koishi-plugin-elysia-ai-model-gateway` | Provider registry and slot config | Legacy direct `slots` remain supported | `providers` + `providerSlots`, with `apiKeyEnv` support | Missing env or unknown provider reference fails fast |
| `koishi-plugin-elysia-ai-observatory` | Repository diagnostics query | Existing gateway analytics | Query by `component` and `repositoryType` | Diagnostics events are observed when plugin is loaded |

Configuration ownership remains unchanged: runtime does not own memory/bond/gateway capability settings. Top-level plugins parse Koishi config and pass pure dependencies into internal factories.
## Phase 44 Operational Boundary

| Capability | JSON config | Code injection | Observable diagnostics |
| --- | --- | --- | --- |
| memory | `repository.type`, `contextLimit`, attribution/context options | `createMongoMemoryRepositoryFactory(collection, options)` | `repositoryAnalytics.byComponent.memory` |
| bond | `repository.type`, `contextLimit`, relevance options | `createMongoBondRepositoryFactory(collection, options)` | `repositoryAnalytics.byComponent.bond` |
| model-gateway | `providers`, `providerSlots`, `fallback`, `retry`, `circuitBreaker` | custom providers remain internal registry/factory concerns | gateway analytics and provider health |
| observatory | `maxRecords`, enabled flag | none | gateway analytics + repository analytics |

The top-level plugins own validation and service registration. Internal `@elysia-ai/*` packages remain implementation libraries and must not own Koishi config parsing or legacy alias registration.

## Phase 45 Operational Surface Mapping

Operational surfaces remain owned by top-level Koishi plugins:

| Surface | Owner plugin | Reads services | Output policy |
| --- | --- | --- | --- |
| `elysia.status` | `koishi-plugin-elysia-ai-observatory` | canonical `elysia.*` services | loaded/ready flags and recent failure count only |
| `elysia.gateway.status` | `koishi-plugin-elysia-ai-observatory` | `elysia.modelGateway` | provider id/type/model and health count; no API keys |
| `elysia.repository.status` | `koishi-plugin-elysia-ai-observatory` | `elysia.observatory` repository analytics | component/type counters and failure counts |
| `elysia.preflight` | `koishi-plugin-elysia-ai-observatory` | explicit preflight callbacks | structured errors/warnings, no secret values |

Preflight ownership:

| Config area | Helper | Owner |
| --- | --- | --- |
| model providers, slots, fallback | `preflightModelGatewayConfig()` | `koishi-plugin-elysia-ai-model-gateway` |
| memory repository | `preflightMemoryConfig()` | `koishi-plugin-elysia-ai-memory` |
| bond repository | `preflightBondConfig()` | `koishi-plugin-elysia-ai-bond` |
| combined report | `runElysiaPreflight()` | `koishi-plugin-elysia-ai-observatory` |

Internal packages under `packages/@elysia-ai/*` remain implementation libraries. They may expose sanitized snapshot/factory primitives, but command registration, Koishi context access, service lookup, legacy alias handling, and lifecycle binding stay in top-level `packages/elysia-ai-*` plugins.

