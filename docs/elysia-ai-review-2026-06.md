# Elysia A.I. 代码审查与下一步开发计划（2026-06）

## 文档用途

本文档是一次完整代码审查的产出，遵循 `elysia-ai-code-review-methodology.md` 的维护原则：
**具体问题清单写入独立记录，不污染方法论文档与路线图主线。**

审查时点：项目处于 **Phase 45**（operator-facing runtime surface 刚收口）。
项目当前是"开发到一半"的状态，因此本审查的核心**不是**要求立刻修复全部功能正确性，而是：

> 把"正确性不足"拆成两类——**路线图尚未建到那里（缺口，不是 bug）** vs **已建成但写错了（真缺陷）**——再据此重排可执行 plan。

---

## 一、分类原则

| 类别 | 定义 | 处置策略 |
|------|------|---------|
| **A 类：尚未开发到位** | 该能力在路线图明确标注"未完成 / 第一轮 / 占位"，正确性不足是因为**还没建到这一步** | 不当作 bug，折叠进"下一步开发"，建一次就建对 |
| **B 类：已完成但存在缺陷** | 该能力被 roadmap 声明为"已完成 / 已支持"，却写错了 | 当作真缺陷，应尽快修（成本低、价值高） |
| **灰色地带** | 功能已 ship，但其"深化治理"在 roadmap 属未来 | 现在补最小正确性兜底，完整版随未来阶段做 |

### 元发现（最重要）

**368 个测试全绿，却没测出中文主路径失效（见 H1/H2）。**
说明现有测试基本使用 ASCII/英文输入，对"中文优先"这一核心定位存在**系统性测试盲区**。
暴露并补齐这一盲区，本身就是下一步要做的方向，而非单点 bug。

---

## 二、A 类：尚未开发到位（缺口，不是 bug，不要现在改）

| ID | 现象 | 对应 roadmap "未完成"声明 | 归属未来阶段 |
|----|------|--------------------------|------------|
| A-H4/H5 | ~~Mongo 仓储 `find({})` 全表加载、retrieve 读变写~~ → **D1 已修**（服务端缩小集合 + `$inc`） | — | ✅ 已完成 |
| A-M5 | ~~bond Mongo 快路径 filter 形状不匹配~~ → **D1 已修**（嵌套 `bond.*` 路径） | — | ✅ 已完成 |
| A-M10 | ~~内稳态只衰减无恢复动力学~~ → **D3-1 已修**（朝基线松弛 idle 恢复 + 仅 routed life tick） | — | ✅ 已完成 |
| A-1 | behavior 无真实 bucket/buffer 池、无 AI enhanced interpretation | behavior "当前仍未完成"明确列出 | 行为层深化（未做） |
| A-2 | ~~model-gateway 占位、无真实 provider~~ → **复核已推翻：D2 实际已完成**（见第六章 D2 复核） | 原判过时 | ✅ 已完成 |
| A-3 | observatory trace 非持久、无 span/duration、无 UI | observatory "当前仍未完成"明确列出 | D4 观测持久化（未做） |
| A-4 | `maxInputTokens`、`cognition/types.ts`、`homeostasis/types.ts` 当前无引用 | 截断/类型治理尚未建到 | 预留脚手架，仅标注不删 |
| A-5 | ~~`Memory*/Behavior*/Homeostasis*/Dialogue*/Persona` 缺 Zod schema~~ → **D3-2 已补齐** | — | ✅ 已完成 |
| A-6 | Redis 辅助层完全未接入 | 设计原则 3.8 + 生命状态层"未完成" | 暂不做（无消费者，避免过度工程；待并发锁/分布式/调度有真实需求再建） |

---

## 三、B 类：已完成但存在真实缺陷（应作为缺陷修）

详见执行记录章节的修复状态。

| ID | 文件:行 | 缺陷 | 为何算 B 类 | 严重度 |
|----|---------|------|------------|--------|
| H1 | perception/src/rules.ts:38-46 | 中文意图/情感正则 `\b` 对 CJK 永不命中 | perception 声称"已支持意图/实体/情感" | 🔴 高 |
| H2 | perception/src/rules.ts:96-101 | 情感词计数恒为 0 或 2，置信度锁死 | 同上，已完成的规则实现 | 🔴 高 |
| H3 | observatory/src/service.ts:282 | 脱敏漏 `summary/text/systemPrompt`/数组 content | Phase 45 自称"按长度摘要 message content" | 🔴 高(安全) |
| M1 | core/src/bus/memory-event-bus.ts:50 | 一个 listener 抛错中止后续并向发布方重抛 | core EventBus 默认实现，已完成 | 🟡 中 |
| M2 | perception/src/index.ts:86 | async listener 无 try/catch，AI 失败致下游静默停摆 | 主链已完成态 | 🟡 中 |
| M3 | scheduler/index.ts:208 | tick 拒绝被 `void` 吞掉无日志 | scheduler v1 "已完成最小闭环" | 🟡 中 |
| M7 | manifest/loader.ts:71 | 重复 id 静默覆盖 | manifest 加载已完成 | 🟡 中 |
| M8 | shared/src/service-registry.ts:73 | `getRequired*` 名实不符返回 undefined | shared 已完成工具 | 🟡 中 |
| M9 | body session-to-platform-message.ts:24 | `isMentioned` 不比对 selfId | body 输入接入已完成 | 🟡 中 |
| M11 | core/src/schemas/projection.ts | `projectionRoutingResultSchema` 缺 `routedAt`；index.ts 注释谎称 schema 一一对应 | schema 存在但写漂移 | 🟡 中 |
| 工程-1 | 16 文件 mojibake（其中 7 处为用户可见的命令/配置描述，已在 R0 修复；其余为注释，留待 R2） | 已 ship 文件编码损坏 | 🟢 低 |
| 工程-2 | 51 个 `.turbo/cache` 被 git 跟踪、913KB trace 日志遗留 | 仓库卫生 | 🟢 低 |
| 债务 | memory↔bond ~500 行镜像、`clampScore`×4、AI-enhanced×2、wrapper×11 样板 | 已完成代码的重复 | 🟢 低 |

---

## 四、灰色地带（已 ship，但完整版属未来）

- **H6 命令无鉴权**：命令是 Phase 45 刚 ship 的；但"权限治理"在 runtime "未完成"里。
  → 现在加最小 `.authority(3)` 兜底（B 类成本），完整 RBAC 随 D4 dashboard 阶段做。
- **M4 scheduler `runTask` 无原子 CAS**：基础双执行守卫（`ticking` 标志）已存在，属 B 类已覆盖；
  但分布式 lease 是 roadmap 明确的未来（A 类），现在不做分布式锁。

## 五、可执行 Plan

原则：**B 类缺陷顺手清掉（便宜，且正在悄悄削弱测试可信度），A 类缺口转成正式开发阶段去"建对"，技术债在测试保护下重构。**
每个阶段以 `yarn test + check:packages + check:source-hygiene` 为出口。
建议严格按 R → D 顺序：R2 的仓储基类是 D1 持久化生产化的前置地基。

### 阶段 R0 · 工程卫生 + 测试盲区暴露
- `.gitignore` 补 `.turbo/`，移除缓存与 913KB trace 日志
- 9 文件转 UTF-8、修复用户可见命令/配置描述
- A-4 死代码仅标注不删（属预留脚手架）
- **关键动作**：先补中文输入的 perception 测试用例（此时应**失败**，暴露 H1/H2），作为 R1 红线

### 阶段 R1 · B 类高危缺陷修复
- H1/H2：中文正则去 `\b`、情感计数用 `/g` → R0 红线测试转绿
- H3：脱敏扩展字段白名单 + 数组 content 按长度摘要
- H6（灰）：命令加 `.authority()` 默认管理员可见
- M1/M2：EventBus listener 隔离 + async listener try/catch
- M3/M7/M8/M9/M11：scheduler 拒绝日志、manifest 重复 id 校验、service-registry 语义对齐、isMentioned 比对 selfId、修 schema 漂移与不实注释

### 阶段 R2 · 技术债收敛（测试保护下重构，0 行为变更）

> 复核（2026-06，二次代码扫描）确认可收敛 ≈1200 行。按风险从低到高排，前两项与持久化解耦可先做。
> **关键约束**：R2-3 仓储基类**不得**照搬现有"继承内存基类 + 每次 `hydrate()` 全表加载"反模式去抽象，
> 否则会把反模式固化。应抽一个**为服务端查询设计**的干净基类，把真实 query 翻译的接缝留给 D1 填。

- **R2-1 原子工具下沉 `@elysia-ai/shared`**（最低风险，先做）：
  `clamp01`/`clampScore`（散落 memory、bond、behavior×3、homeostasis ≈6 处）、
  `extractTextFromStimulus`（perception/rules.ts:12-20 与 cognition/salience.ts:14-22 字节级相同）、
  AI-JSON 解析 `parseJsonObjectFromText`/`normalizeSelectedIds`/`normalizeReasonById`（memory↔bond 重复）。
- **R2-2 抽 `AiAssistedRelevanceSelector<TItem,TId>` 泛型**：
  `AiAssistedMemoryRelevanceSelector`（memory:454-624）与 `AiAssistedBondRelevanceSelector`（bond:223-401）≈95% 镜像各 ~165 行；
  泛型基类持 `withTimeout(brain.execute)`→解析→失败回退规则版骨架，差异用注入 mapper 表达（~330→~120 行）。
  **前置**：先确认 memory/bond 现有测试覆盖 AI 回退路径，不足则补红线再重构。
- **R2-3 干净 Mongo 仓储基类 `MongoDocRepository<TDoc>`**（D1 的桥）：
  封装裸 driver 的连接/集合句柄、`upsert`（`$set`+`$setOnInsert`）、`ensureIndexes(builders)`，
  **预留 `query` 钩子供 D1 填服务端翻译**。memory/bond Mongo 类各 ~180 行样板 → ~40 行。
- **R2-4 `createElysiaPlugin()` 收敛 wrapper 样板**（独立，可并行）：
  9–11 个 `elysia-ai-*` 顶层包 `apply()` 有 ~40-60 行同构样板（取 runtime 服务→门控 `eventBus`→建 pluginRuntime→注册→dispose）。
  抽 HOF `createElysiaPlugin({ name, Config, deps, runtimeFactory })`，顺手统一依赖门控漂移（~400→~150 行）。

---

### 以下转入"下一步开发"（A 类，按 roadmap 优先级建对）

### 阶段 D1 · 持久化生产化（核心下一步，对照设计 3.8）✅ 已完成

> **技术路线已定（2026-06）：裸 `mongodb` driver** + **用户自部署、仅 URL 连接、`mongodb` 为可选依赖**
> （用户拍板，不内置数据库、不走 Koishi minato）。执行详情见第六章 D1 执行记录。

- **D1-1 真实服务端查询** ✅：memory/bond 查询按 lifeId/stimulusId 服务端缩小集合，删除全表 `hydrate()`；
  顺带修 A-M5（bond `getByLifeAndTarget` 改嵌套 `bond.*` 路径）。关键判断：tags 大小写、targetType 归一化、
  text 子串扫描等无法干净映射为 Mongo 等值，故只下推高选择性 lifeId、精细过滤保持原逻辑 → 零语义偏移。
- **D1-2 原子计数器** ✅：`MongoDocRepository.increment()` 用 `$inc`；memory `retrieve()` 鸭子探测原子能力，
  测试证实"10 并发自增→10"（旧读-改-写仅得 1）。
- **D1-3 补齐 Mongo 覆盖面** ✅：新建 `MongoProjectionRuleRepository`、`MongoScheduledTaskRepository`。
  Stimulus 仓储视需要；Trace 持久化留给 D4。
- **D1-4 契约测试** ✅：服务端缩小集合、原子并发、软删生效、重启恢复（24 例新测试覆盖 D1 全部）。
- **D1-5 真实接线** ✅：`@elysia-ai/shared/mongo-connector.ts` 提供 `connectMongo(uri)` + `lazyMongoCollection`；
  memory/bond 配 `mongo.uri` 即启用，无需宿主注入工厂。**不内置 `mongodb-memory-server`**（用户自部署），
  连接失败的索引建立记录而非崩溃。

### 阶段 D2 · 真实 model provider + 网关韧性 ✅ 已完成（复核确认）
- 接 OpenAI/Gemini/Claude 真 provider；provider registry 动态注册 ✅
- retry / fallback / circuit-breaker 机制 ✅（复核详情见第六章 D2 复核）

### 阶段 D3 · 生命状态层深化（D3-1/D3-2 已完成；D3-3 收口为"暂不做"）
- A-M10 ✅：内稳态恢复动力学——朝基线松弛（高于基线衰减 / 低于基线 idle 恢复，速率 = decay×recoveryFactor，不越过基线）+ **仅对 routed life tick**（挂在 `projection.routed`，不再全量空转）。正向交互回升复用既有 `behavior.homeostasis.update.requested` 通道（sentiment-aware），未另造入口。
- core schema 补齐（A-5）✅：memory/behavior/homeostasis/dialogue/persona 五个 Zod schema。
- ~~接 Redis 辅助层~~ → **暂不做**：当前无任何消费者等待 Redis，硬接属过度工程；待并发锁/分布式/调度有真实需求再按"Redis 非事实源 + URL 连接 + 可选依赖"建。

### 阶段 D4 · 观测持久化 + 运维面（未做）
- TraceRepository 持久化、span/duration 统计
- Koishi console/dashboard UI + H6 完整 RBAC

---

## 六、执行记录（R0 + R1 + R2）

> 本节随修复进度滚动更新。每条记录格式：`[状态] ID — 文件 — 一句话变更`。

### 验证出口（全部通过）
- **R0+R1 完成时**：`npx vitest run` → 389 passed / 60 files；`check:source-hygiene` passed；`check:packages` 全包 TS 编译通过。
- **R2 完成时**：`npx vitest run` → **393 passed / 61 files**（R2 新增 4 个工厂契约测试）；
  `check:packages` 全包编译并重建 lib；`check:source-hygiene` passed。R2 全程 0 行为变更。

### R0 工程卫生
- [完成] 工程-2 — `.gitignore` — 补 `.turbo` 与 `trace-runtime-resolution.log`
- [完成] 工程-2 — 仓库 — 删除 913KB trace 日志、`git rm --cached .turbo`（51→0）、清理磁盘缓存目录
- [完成] 工程-1 — perception/cognition/homeostasis wrapper — 3 处用户可见 `Schema.description` 乱码改为正确中文
- [完成] 工程-1 — model-gateway/index.ts — 4 条调试命令描述去 `??` 乱码
- [完成] 测试盲区 — 新增 `__tests__/r1-perception-cjk.test.ts`（9 例），提交时先复现 H1/H2 失败（7 红）再转绿
- [说明] A-4 死代码（`maxInputTokens` / cognition/homeostasis `types.ts`）经核为预留脚手架，**仅标注不删**
- [遗留] 注释类 mojibake（约 13 个文件）不影响运行，留待 R2 触及对应文件时顺手转 UTF-8

### R1 B 类缺陷
- [完成] H1 — perception/src/rules.ts — 意图正则拆分 CJK / ASCII 组，去除包裹中文的 `\b`
- [完成] H2 — perception/src/rules.ts — 情感正则改全局 `/g` 真实计数，置信度 `Math.min` 封顶
- [完成] H3 — observatory/src/service.ts — 脱敏白名单扩展至 `content/text/summary/systemprompt/prompt/usermessage/reply/output`，数组形态按 count 摘要；新增 `r1-observatory-sanitize.test.ts`（5 例）
- [完成] H6 — observatory/index.ts、model-gateway/index.ts — 运维/调试命令加 `{ authority: 3/4 }` 默认管理员可见
- [完成] M1 — core/src/bus/memory-event-bus.ts + event-bus.ts — emit listener 隔离（不中断其余、不向发布方重抛），并写入接口契约；新增 `r1-event-bus-isolation.test.ts`（3 例）
- [完成] M2 — perception/src/index.ts — `stimulus.received` async listener 加 try/catch，感知失败显式记录不静默
- [完成] M3 — scheduler/index.ts — `startLoop` 的 `tick` 补 `.catch` 记录整体性失败（如 listDue）
- [完成] M7 — manifest/loader.ts — 重复 life-instance id 改为校验抛错（原静默覆盖）
- [完成] M8 — shared/src/service-registry.ts — `getRequiredElysiaService` 补契约 JSDoc，明确“记录缺失并降级、不抛错”语义（与 Phase 42 降级契约一致，不改行为）
- [完成] M9 — body/session-to-platform-message.ts — `isMentioned` 比对 `selfId`，@他人不再误判；新增 `r1-body-is-mentioned.test.ts`（4 例）
- [完成] M11 — core/src/schemas/projection.ts + index.ts — 补 `routedAt`/`matchedRules`（新增 `projectionRuleSchema`），修正 index.ts “schema 一一对应”不实注释

### 下一步
R2 已完成（见下）。D1–D4 开发阶段见第五章。建议严格按 R → D 顺序：R2 的 `MongoDocRepository` 基类是 D1 持久化生产化的前置地基。

### R2 技术债收敛（测试保护下重构，0 行为变更）
验证出口：`npx vitest run` → **393 passed / 61 files**、`check:packages` 全包编译通过、`check:source-hygiene` passed。
- [完成] R2-1 — `@elysia-ai/shared/numeric-utils.ts` + `stimulus-utils.ts` — 下沉 `clampUnit`/`clampUnitOr`（[0,1]）、`clampPercent`（[0,100] 取整，behavior 量纲）、`extractTextFromStimulus`；memory/bond/homeostasis/behavior×4/perception/cognition 改 import 去本地副本。**命名刻意区分两种量纲**，避免 0-1 与 0-100 误并。
- [完成] R2-1 附带 — 删除 `elysia-ai-runtime/src/relevance-selection/index.ts`（94 行，与 shared 版字节级相同的死复制，全仓无 import）。
- [完成] R2-2 — `@elysia-ai/shared/ai-relevance-selector.ts` — 抽 `AiAssistedRelevanceSelectorBase<TItem,TRequest,TResult>`；memory（`AiAssistedMemoryRelevanceSelector`）与 bond（`AiAssistedBondRelevanceSelector`）改为继承，去除 ~95% 镜像的 AI 回退/超时/JSON 解析骨架。
- [完成] R2-3 — `@elysia-ai/shared/mongo-doc-repository.ts` — 抽 `MongoDocRepository<TDomain,TDoc>` 裸 driver 基类（连接/集合句柄、`upsert`、`ensureIndexes`，**预留 query 钩子供 D1 填服务端翻译**）；`MongoMemoryRepository`/`MongoBondRepository` 改为组合该基类。
- [完成] R2-4 — `@elysia-ai/shared/plugin-factory.ts` — `createElysiaPlugin()` 收敛 **7 个标准 wrapper**（perception/cognition/behavior/homeostasis/brain/dialogue/persona）的 apply() 生命周期骨架。带仓储工厂/命令注册/自定义事件接线的 5 个 wrapper（memory/bond/model-gateway/observatory/body）按设计保持显式实现。

### D1 持久化生产化（裸 mongodb driver，已完成）
验证出口：`npx vitest run` → **417 passed / 64 files**（R2 后 393 + D1 新增 24）、`check:packages` 全包编译通过、`check:source-hygiene` passed。
环境实情：仓库未装 `mongodb` driver，仓储依赖**结构化集合契约**（`MongoDocLikeCollection`）而非真实包；`mongodb` 为可选运行时依赖（用户自部署、配 URL 连接），故 D1 写的查询/计数/连接代码即真实 Mongo 行为，由忠实 Fake（实现嵌套点路径 filter + `$inc`）验证。
持久化覆盖面现已闭环：**state / memory / bond / projection-rule / scheduled-task 全部可落 Mongo**。
- [完成] D1-1 — `@elysia-ai/shared/mongo-doc-repository.ts` + memory/bond — 新增 `findMany(filter)`，`MongoMemoryRepository`/`MongoBondRepository` 的 `query`/`listByLifeId`/`listByStimulusId`/`listByLife` 改为**只按 lifeId/stimulusId 服务端缩小集合**，在子集上跑继承的内存过滤（零语义偏移），**彻底移除每次查询的 `hydrate()` 全表加载**。
- [完成] A-M5 顺带修复 — bond `getByLifeAndTarget` 的 `findOne` 改用嵌套 `bond.*` 路径（原顶层 `{lifeId,targetId}` 对真实 Mongo 永不命中）。
- [完成] D1-2 — `MongoDocRepository.increment()` 用 `$inc` 原子自增；新增 `MongoMemoryRepository.incrementAccess`，memory service `retrieve()` 鸭子类型探测该能力，存在则走服务端 `$inc`、否则退回读-改-写（内存仓储）。契约测试证实"10 并发自增 → accessCount=10"（旧读-改-写仅得 1）。
- [完成] D1-4 — 新增 `__tests__/d1-mongo-persistence.test.ts`（9 例）：服务端缩小集合（断言 find filter 带 lifeId、无全表）、tags 大小写语义保留、targetType 归一化、原子并发、软删即时生效、重启恢复。
- [完成] D1-3 — `elysia-ai-runtime/src/projection/mongo-projection-rule-repository.ts` + `scheduler/mongo-scheduled-task-repository.ts` — 用同一套 `MongoDocRepository` 基类实现两仓储的 Mongo 版（此前完全无）。ProjectionRule：`listByLifeId` 服务端按 `rule.lifeId` 缩小，`listEnabled`/`listAll` 全量取后内存筛（小集合可接受）。ScheduledTask：`listDue` 按 `task.status='pending'` 服务端缩小后内存排序/截断；`complete/fail/cancel` 为单 id 状态迁移（读-改-写单条）。落库后**调度器可跨重启续跑、投影规则可持久**。
  - 新增 `__tests__/d1-mongo-runtime-repositories.test.ts`（8 例）：CRUD、维度查询、listEnabled undefined 语义、listDue 排序、complete/cancel/fail 状态迁移、重启恢复。
  - 验证出口：`npx vitest run` → **417 passed / 64 files**、`check:packages` 全包编译、`check:source-hygiene` passed。
- [完成] D1-5 — **架构决策（用户拍板）：项目不内置 MongoDB，用户自部署，仅用 URL 连接；`mongodb` 为可选依赖**。
  - 新增 `@elysia-ai/shared/mongo-connector.ts`：`connectMongo(uri)`（动态 `import('mongodb')`，未装则给明确安装指引）+ `lazyMongoCollection`（惰性连接——同步可得集合句柄，首次读写才连库，连接只建一次，dispose 关闭）。复用 `runtime-state-repository.ts` 已验证的 DI + connect/close 形态。
  - memory/bond 顶层插件新增 `mongo.uri`/`mongo.database` 配置：配了 URL 即内建 mongo 仓储，**不再强制宿主注入 `repositoryFactory`**；连接失败的索引建立改为记录而非未捕获 rejection；dispose 关闭连接。
  - 新增 `__tests__/d1-mongo-connector.test.ts`（7 例）：URL connect/close、惰性连接只建一次、never-connect 时 close no-op、memory/bond 配 uri 即用 Mongo 实现、无 uri 无 factory 时 fail fast。
  - 验证出口：`npx vitest run` → **409 passed / 63 files**、`check:packages` 全包编译、`check:source-hygiene` passed。

### D2 复核（真实 model provider + 网关韧性）——原 A-2 判断已推翻
复核动机：着手 D2 前按惯例核实 model-gateway 现状，发现**早已完整实现**（与 R2-2/3/4 同因——前序会话完成但文档未同步）。原 A-2"占位、无真实 provider、无 retry/fallback"为过时判断。
经逐文件 + 测试核实确认现状：
- **真实 provider 全部存在**（裸 `fetch`，无 stub/echo）：`providers/openai.ts`（chat-completions + responses 两模式）、`claude.ts`（`/v1/messages` + `x-api-key` + system 抽取）、`gemini.ts`（`:generateContent` + systemInstruction）、`openai-compatible.ts`（委托 OpenAI 逻辑、保留语义描述符）。`utils.ts` 提供 `fetchWithTimeout`（AbortController 超时 → retryable `timeout`/`network-error`）。
- **网关韧性全部接通**（非声明未用）：`executeWithRetry` 指数退避 + `isRetryableError` 门控；`ProviderHealthTracker` 实现熔断状态机（连续失败 → open → cooldown → 半开探针）；`resolveCandidateSlots`/`shouldFallback` 实现按槽位 fallback 链。
- **测试覆盖充分**：phase30/31/33/44 共覆盖 provider 归一化、retryable/non-retryable 分类、诊断记录、熔断 open→cooldown→fallback、跨 provider fallback。
- 验证出口：`npx vitest run`（gateway 相关 4 文件）→ **28 passed**；全量 **417 passed / 64 files** 不变。
- 结论：**D2 无需新增实现**，仅修正文档。唯一可考虑的后续增强是 provider 真实网络的集成冒烟（需真实 key，留作可选运维验证，不进单测）。

### D3 生命状态层深化（D3-1 + D3-2）
验证出口：`npx vitest run` → **428 passed / 65 files**（D2 后 417 + D3 新增 11）、`check:packages` 全包编译、`check:source-hygiene` passed。
- [完成] D3-1 — `@elysia-ai/homeostasis/src/index.ts` — 衰减改为 `relaxTowardBaseline`（朝基线松弛：高于基线衰减、低于基线以 `decay×recoveryFactor` 恢复、不越过基线），新增 `energyBaseline/moodBaseline/sociabilityBaseline/curiosityBaseline/recoveryFactor` 配置。
  - **设计修正**：tick 原计划挂 `perception.completed` + 缓存 routing，但实跑发现 runtime 真实事件序为 `stimulus.received → perception.completed → projection.routed`（routing **晚于** perception）。改为直接挂 `projection.routed`（自带 lifeIds、是"生命被激活"时点），无需缓存且时序正确；**仅 tick 被路由的生命**，不再 `lifeRegistry.getAll()` 全量空转。
  - 正向交互回升复用既有 `behavior.homeostasis.update.requested`（runtime homeostasis service 已消费、sentiment-aware），未另造入口；据此删除一度引入的 `positiveInteractionRebound` 死配置。
  - 顺带修复该文件注释 mojibake。同步更新 phase8/phase11/phase14 集成测试以反映"tick 由 projection.routed 驱动 + 基线平衡态"语义。
- [完成] D3-2 — `@elysia-ai/core/src/schemas/{memory,behavior,homeostasis,dialogue,persona}.ts` — 新增 5 个 Zod schema（照搬 stimulus/bond 风格），从 core barrel 导出，修正 index.ts "尚未补齐"过时注释。
- [完成] D3-4 测试 — 新增 `__tests__/d3-life-state-layer.test.ts`（11 例）：衰减/恢复/不越基线/平衡态不漂移/仅 routed tick/空 lifeIds 不 tick + 5 schema 合法非法校验。
- [收口] D3-3 Redis — **暂不做**（无消费者，避免过度工程）。

### R2 技术债收敛（0 行为变更，测试保护下重构）
- [完成] R2-1 — `@elysia-ai/shared/src/numeric-utils.ts` + `stimulus-utils.ts` — 下沉 `clampUnit`/`clampUnitOr`/`clampPercent`（按量纲区分命名，避免 0-1 与 0-100 混用）与 `extractTextFromStimulus`；memory/bond/behavior×4/homeostasis/perception/cognition 共 8 文件改为 import，删除各自本地定义
- [完成] R2-1 附带 — `packages/elysia-ai-runtime/src/relevance-selection/` — 删除与 shared 字节级重复且无任何引用的死模块（94 行）
- [完成] R2-2 — `@elysia-ai/shared/src/ai-relevance-selector.ts` — 抽 `AiAssistedRelevanceSelectorBase<TItem,TRequest,TResult>` 泛型基类，承载 requested→无brain回退→execute(超时)→解析→构造items→诊断→completed/failed/fallback 全骨架；memory/bond 的 AI 选择器改为薄子类（仅注入 id 取值/事件名/prompt/fallback），消除 ~280 行镜像
- [完成] R2-2 安全网 — 复用既有 phase25/27/28 共 16 例选择器测试（含 invalid JSON / invalid ids / timeout / fallback 事件 / 诊断对齐）验证 0 行为变更
- [完成] R2-3 — `@elysia-ai/shared/src/mongo-doc-repository.ts` — 抽 `MongoDocRepository<TModel,TDoc>` 裸 driver 仓储基类（封装 find 游标归一化 / `$set`+`$setOnInsert` upsert / findById / ensureIndexes(批量) / deleteById）；memory/bond 的 Mongo 仓储改为**组合委托**，保留各自 hydrate-to-memory 行为不变；`loadAll()`/`query 钩子`预留为 D1 服务端直查的接缝
- [完成] R2-4 — `@elysia-ai/shared/src/plugin-factory.ts` — 抽 `createElysiaPlugin()` HOF（logger→runtime门控→eventBus门控→build→注册→dispose）；perception/persona/behavior/brain/dialogue/cognition/homeostasis 共 7 个标准 wrapper 迁移；memory/bond/model-gateway/observatory/body 5 个含仓储工厂/命令注册/自定义事件接线的 wrapper 保持显式（强抽象得不偿失）
- [完成] R2-4 新测试 — `__tests__/r2-plugin-factory.test.ts`（4 例）— 覆盖此前未测的成功注册路径与 dispose 清理路径，以及无 eventBus / build 返回 undefined 两条门控

### 仍待开发（A 类，需用户确认后启动）
D1 持久化生产化（裸 mongodb driver）→ D2 真实 provider → D3 生命状态层深化 → D4 观测持久化，详见第五章。


