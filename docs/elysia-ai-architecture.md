# elysia-ai 项目整体调查报告

> 一句话定位：**elysia-ai 是一个运行在 Koishi 平台上的仿生 AI 智能体框架——它不是"收到消息就回一句"的聊天插件，而是用来托管、维持、调度虚拟生命体的运行系统。** 生命体（Life）有人格、有记忆、有跟每个用户的关系、有随时间起伏的内部状态，会自己决定要不要回、怎么回。工程形态是 34 包双层 monorepo（21 个 `@elysia-ai/*` 能力库 + 13 个 `koishi-plugin-elysia-ai-*` 薄壳插件），协议栈与 Go 上游 Elysia-Api v1.4.0 逐函数对齐。全部生命体定义在一个 manifest.json 里，模型凭据在 koishi 控制台的 model-gateway 配置页里，剩下的交给框架。

整个框架的心智模型是一条主干流水线加一组旁路状态层：

```
聊天平台消息（QQ / Discord / Telegram / …）
   │ koishi session → 纯文本 platformMessage → Stimulus（body 层唯一合法构造点）
   ▼
【body 桥接】刺激归一化 · 出站发送三级兜底
   ▼
【runtime 内核】同 habitat 优先级串行队列 · manifest 生命体加载 · 投影路由
   ├─► 刺激段（每条刺激一次）：stimulus.received → perception（意图/情绪/实体规则富化）
   ├─► 投影路由：这条刺激命中哪些 habitat 里的哪些生命体
   └─► 生命段（每个命中生命体一次）：cognition（事件账本）→ behavior（三层分发/唤醒决策）
                                       → dialogue（上下文组装）→ brain（prompt + 工具循环）
                                                      │
                                                      ▼
                                       【model-gateway】Provider/Slot 路由 · 重试/熔断/回退
                                                      │ Maheshvara 统一中间表示
                                                      ▼
                     openai / anthropic / gemini / responses / custom 五协议包（encode→线制，decode←线制）
                                                      │
                                                      ▼
                                                 模型厂商 API
                                                      │ MaheshvaraResponse（文本 + 工具调用）
                                                      ▼
        聊天平台 ◄── body sender ◄── dialogue 多段输出（dialogue.output.created）──┘

旁路状态层（事件总线驱动，不阻塞主链）：memory（长期记忆）· bond（羁绊）· homeostasis（内稳态）· persona（人格）· observatory（观测）
```

- **body / runtime** 是框架的"脊髓"：把平台消息翻译成内部刺激，按 habitat 排队，路由给生命体。
- **perception → cognition → behavior → dialogue → brain** 是"条件反射弧"：富化刺激、记账、决定是否唤醒、组装上下文、生成回复。
- **model-gateway + maheshvara + 五协议包** 是"发声器官"：任何模型厂商的差异在这一层被吸收成统一中间表示。
- **memory / bond / homeostasis / persona** 是"内分泌系统"：由事件驱动悄悄更新，在下次唤醒时注入 prompt。

## 1. 仓库与工程全景

### 1.1 两层仓库结构

| 层 | 路径 | 是什么 |
|---|---|---|
| 宿主工作区 | `koishi-elysiaAI/`（非 git） | Koishi 运行宿主：koishi.yml、data/、全套 @koishijs 官方插件依赖；workspaces 把 elysia 包纳入 yarn 4.1.0 管理 |
| monorepo 本体 | `external/elysia-ai/`（git 跟踪） | 34 包 monorepo：`packages/@elysia-ai/*` 能力库 21 个 + `packages/elysia-ai-*` 插件薄壳 13 个；另含 docs/（15 篇 6,762 行）、examples/、scripts/、__tests__/ |

插件薄壳与能力库的分工是刻意的：薄壳只有 1 个 `src/index.ts`（50–330 行），负责 `name`/`inject`/`Config` Schema/`apply` 装配；逻辑重量全部在 `@elysia-ai/*` 作用域包里（宿主无关、可单测）。例外是 `elysia-ai-runtime`（2,632 行）与 `elysia-ai-body`（1,000 行）——这两个插件自身承载运行时与适配逻辑。

薄壳插件的运行时依赖只有 `@elysia-ai/core` + `@elysia-ai/shared`，对应逻辑库（如 `@elysia-ai/brain`）放 devDependencies——这是为了绕开宿主 yakumo/dumble 打不出 CJS bundle 的问题（readme 有专节记录）；唯一例外 `elysia-ai-body` 把 runtime 插件放进了 dependencies。

### 1.2 能力库清单（`packages/@elysia-ai/`，21 个）

| 包 | 版本 | src 行数 | 职责 |
|---|---|---|---|
| kernel | 0.1.1 | 1,024 | 宿主无关子框架内核：类型化事件总线、DAG 阶段管线、manifest 兼容治理、测试 harness（examples/elysia-plugin-emotion 是示范） |
| maheshvara | 0.3.0 | 1,512 | 跨协议统一模型中间表示（§7） |
| protocol-openai | 0.3.0 | 1,141 | OpenAI Chat Completions 协议包（含 OpenRouter 兼容） |
| protocol-responses | 0.3.0 | 802 | OpenAI Responses 协议包 |
| protocol-anthropic | 0.3.0 | 973 | Anthropic Messages 协议包 |
| protocol-gemini | 0.3.0 | 873 | Google Gemini 协议包 |
| protocol-custom | 0.3.0 | 3,897 | 自定义协议引擎："协议即数据"，JSON 配置描述供应商线制（§7.4） |
| core | 0.2.1 | 2,938 | 领域类型、事件总线、阶段表、服务名单一事实来源、Zod schema |
| shared | 0.2.1 | 1,250 | 服务注册、Mongo 仓储基类、createElysiaPlugin 插件工厂 |
| model-gateway | 0.3.0 | 2,365 | 网关核心：providers/slots/重试/熔断/回退/诊断（§8） |
| brain | 0.2.2 | 631 | prompt 组装、上下文预算、agentic 工具循环（§6.2） |
| dialogue | 0.2.1 | 488 | 对话编排、上下文组装（§6.1） |
| behavior | 0.2.1 | 2,293 | 三层分发行为层（§4） |
| trigger | 0.2.0 | 1,180 | 触发器底座：指令系统、即时应对、密度批处理、TriggerManager、事件目录 |
| cognition | 0.2.1 | 219 | 事件注入层（§5.1） |
| perception | 0.2.1 | 290 | 纯规则感知富化（§3 步骤 2） |
| memory | 0.1.1 | 1,725 | 长期记忆存取与检索（§5.2） |
| bond | 0.1.1 | 1,162 | 五维羁绊关系（§5.3） |
| homeostasis | 0.1.1 | 278 | 内稳态四值状态（§5.4） |
| persona | 0.1.1 | 152 | 人格注册表（§5.5） |
| observatory | 0.2.2 | 1,261 | 观测/追踪（§9） |

### 1.3 插件薄壳清单（`packages/elysia-ai-*`，13 个，npm 名 `koishi-plugin-elysia-ai-*`，全部 0.2.2）

runtime(2,632 行)、body(1,000)、behavior(328)、model-gateway(251)、observatory(193)、memory(120)、bond(121)、homeostasis(81)、brain(66)、cognition(63)、dialogue(60)、persona(54)、perception(49)。全部 `peerDependencies: koishi ^4.18.0`，构建统一为 `clean → tsc --emitDeclarationOnly → esbuild bundle ×2`（`lib/index.cjs` + `lib/index.mjs`）。

### 1.4 构建与测试设施

- **构建**：monorepo 根 `build` = `turbo run build`（build `dependsOn: ["^build"]`，outputs `lib/**`）；产物统一 CJS+ESM 双格式（core/shared 必须 ship 双格式，否则运行时 ERR_PACKAGE_PATH_NOT_EXPORTED——readme 记录过这个教训）。宿主侧 build = `yakumo build && yarn workspace @root/elysia-ai run build` 两段式。
- **测试**：vitest，**22 条 alias 把所有包名映射到 `src/index.ts` 源码**（测源码不测产物），koishi 映射到 `__mocks__/koishi.ts`（126 行假 Context）。共 **109 个测试文件**：根 `__tests__/` 63 个（约 15,169 行）+ 包内 45 个 + example 1 个；2026-09 发布前全量 842 用例全绿。
- **测试命名即演进史**：`phase1~phase45`（阶段验收）、`d1/d3`（持久化生产化）、`r1~r3`（审查修复轮）、`wave1~wave3`（2026-09 批量修复）、`gateway-*`、`schema-*`、`koishi-*`（宿主边界）。
- **工程卫生脚本**（`scripts/`）：`patch-tsconfig.js`（postinstall 向宿主 tsconfig 注入包路径）、`check-source-hygiene.cjs`（禁 src 下产物、lib/src 失配检测）、`check-packages.cjs`（tsc -b 全量）、`scaffold-package.mjs`（第三方插件脚手架，含 createHarness 测试模板）、`verify-entrypoints.cjs/.mjs`。
- **代码量**：包内 src 非测试约 31,472 行 + 包内测试约 5,784 行 + 根测试约 15,169 行，**全仓 TS 约 5.3 万行**。

## 2. 核心抽象：kernel 管线与事件分工模型

### 2.1 "命令走阶段、事实走事件"分工（2026-10 起单轨装配）

主链插件**只以阶段钩子装配**（单轨；2026-10 移除了事件兜底路径），事件总线不再承载主链处理，仅作事实通知：

| 轨道 | 机制 | 用途 | 声明处 |
|---|---|---|---|
| 阶段管线（命令路径） | `pipeline.registerHook({stage, owner, run})`，共享上下文命名空间传数据 | 主链编排 backbone：处理**步骤** | `@elysia-ai/core/src/pipeline/index.ts` |
| 事件总线（事实路径） | `runtime.context.eventBus`（`MemoryEventBus<CoreEventMap>`，**不是 koishi ctx.emit**） | 已发生**事实**的通知：观测/旁路消费者订阅 | `@elysia-ai/core/src/bus/event-map.ts`（全部事件见 docs/elysia-ai-events-reference.md） |

### 2.2 七阶段 DAG 与两段切分

```
stimulus.received → perception → cognition → behavior.decide → behavior.execute → dialogue → sender
                                  ▲ PHASE_BOUNDARY_STAGE（锚点）
```

- **刺激段**（锚点之前，每条刺激跑一次）：stimulus.received → perception。
- **生命段**（锚点起，每个路由命中的 lifeId 跑一次）：cognition → … → sender；生命段上下文以刺激段为父链，perception 结果自动可见。
- 第三方阶段按拓扑位置自动归段（`splitStageOrder` 动态切分当前全量阶段表，不漏第三方插入的阶段——Review BUG-1 的修复核心）。

### 2.3 服务名单一事实来源

`ELYSIA_SERVICES`（`@elysia-ai/core/src/pipeline/index.ts`）登记 14 个服务，cordis 单名注册（Phase 36 改名期的 elysia-ai-* 旧名兼容层已于 2026-10 清除）：

| formalName | 层 | 职责 |
|---|---|---|
| elysia.runtime | runtime | 运行时内核（同时提供 elysia.persistence） |
| elysia.persistence | runtime | 持久化集合服务（Mongo 句柄分发） |
| elysia.body | body | 消息输入输出桥接 |
| elysia.perception | perception | 刺激感知分析 |
| elysia.homeostasis | homeostasis | 内稳态状态 |
| elysia.cognition | cognition | 事件注入层（events 变量数据源） |
| elysia.persona | persona | 人格注册表 |
| elysia.behavior | behavior | 行动层（三层分发+定时触发器） |
| elysia.dialogue | dialogue | 对话编排 |
| elysia.brain | brain | 模型调用大脑 |
| elysia.modelGateway | model-gateway | 模型网关 |
| elysia.memory | memory | 记忆服务 |
| elysia.bond | bond | 关系服务 |
| elysia.observatory | observatory | 观测服务 |

### 2.4 插件间三种衔接机制（并存）

1. **cordis 服务注入**（强依赖）：wrapper 顶部 `export const inject = ['elysia.runtime', ...]`；可选依赖经 `getOptionalElysiaService` 解析并显式告警降级（behavior→cognition/homeostasis/body，dialogue→memory/bond，memory/bond→persistence）。（runtime 形状回填兼容字段已于 2026-10 移除。）
2. **管线阶段钩子**（主链，优先路径）：perception 写 `NS_PERCEPTION`，behavior 写 `NS_BEHAVIOR`，dialogue 写 `NS_DIALOGUE_OUTPUT`，body 的 sender 阶段读之发送。
3. **事件总线**（事实/旁路通知，不承载主链处理）：关键事件链 `stimulus.received → perception.completed → projection.routed → cognition.event.recorded → behavior.trigger.fired → behavior.instruction → dialogue.task.created/…/completed → sender.started/completed → body.message.sent`；状态侧 `life.loaded`、`homeostasis.updated`、`behavior.memory.update.requested`、`behavior.bond.update.requested`、`runtime.trace.completed`。

装配工厂：`@elysia-ai/shared/src/plugin-factory.ts` 的 `createElysiaPlugin()`（取 runtime 服务 → 注册 kernel manifest → build() → 注册服务 → dispose 托管）。

## 3. 消息主链：一条刺激的完整旅程

### 3.1 入站（body）

`ctx.on('message')` → `sessionToPlatformMessage()`（剥离 Koishi 元素为纯文本）→ `platformMessageToStimulus()`（`src/normalize/session-to-stimulus.ts`，**body 层唯一合法 Stimulus 构造点**）：type=`utterance`，habitatId 取 `guildId > channelId > userId`。三个关键防护与扩展：

- **bot 自身消息不进主链**（P0 自言自语死循环修复）：转 `bot-sent` system 事件刺激，只记账不唤醒。
- 监听 `guild-member-added/removed`（appearance 刺激）与 `notice/onebot`（QQ 贴表情 reaction，兼容 NapCat 分支适配器）。

### 3.2 派发（runtime）

`DefaultRuntime.receiveStimulus(stimulus, {priority})`：

1. **同 habitat 优先级串行队列**（`stimulusQueues` Map）：数值小者先、同级 FIFO、执行中不可抢占；**跨 habitat 并行**。即时应对唤醒用 priority 0 插队，普通唤醒 priority 1。
2. `processStimulus()`：emit `stimulus.received` → 跑刺激段管线。
3. **投影路由** `DefaultProjectionResolver.resolve()`：无规则时回退"全部 active 生命体"；有规则按 habitatId/channelId/threadId/actorId/platform/botId 匹配 + priority 排序 → emit `projection.routed`。
4. 对每个命中 lifeId 以父链 context 跑生命段管线（cognition → … → sender）。
5. trace 完成回调 emit `runtime.trace.completed`（observatory 消费）。

**生命体隔离**：注册表（Life/Habitat/Persona 三个 Memory Registry）+ cognition 历史按 `lifeId:habitatId` 作用域 + memory/bond 全部以 lifeId 为首键 + 对话 scopeKey 统一由 `createConversationScopeKey(lifeId, scope)` 生成 + behavior 的 `dispatchConsumed` 元数据保证多 life 共享副作用只执行一次。

### 3.3 出站（body sender）

三级兜底：`OutboundRouteRegistry`（stimulusId→session.send 闭包，FIFO 500 条）→ `HabitatSendRegistry`（habitat 级回退）→ `RouteMessageSender`（bot 直发）。输出由 `sender` 阶段钩子读共享上下文 `NS_DIALOGUE_OUTPUT` 发送（`dialogue.output.created` 事件照发，供观测消费）；发送前后 emit `sender.started/completed/failed` 与 `body.message.sent/failed`。

## 4. 触发体系：三层分发与定时唤醒

behavior 是"要不要出声、怎么出声"的决策层，核心是**三层分发**（`@elysia-ai/trigger`）：

| 层 | 引擎 | 判定 | 动作 |
|---|---|---|---|
| ① 指令直达 | `CommandSystem`（trigger/src/commands.ts） | 别名长度优先匹配 | 模板回执直发（`{{user}}/{{content}}/{{match.N}}`），权限 all/uids，全局+每人冷却，**不经过 LLM** |
| ② 即时应对 | `InstantEngine`（trigger/src/instant.ts） | 规则=keywords/regex/startsWith/uids（同组 OR 跨组 AND） | `llm`（合成 priority 0 刺激插队唤醒）或 `send-text`（模板直发）；内置默认规则"被@必应、私聊必应"（3s 冷却） |
| ③ 密度合并 | `AdaptiveBatcher`（trigger/src/batcher.ts） | 四触发路径：max-batch / density / max-wait / quiet（200ms tick 轮询） | 攒批后唤醒一次；私聊用独立 `dmQuietWindowMs` |

**唤醒机制**：`fireTrigger()` 合成 `type:'addressing'`、`isMentioned:true` 的 Stimulus（携带 `triggerSource/triggerReason/directive/wakeActor`），经 `runtime.receiveStimulus(stimulus, {priority})` 走完整主链——唤醒不是旁路，是"伪造一条被点名的消息"。

**decide 钩子** `buildWakeArtifact()` 组装唤醒提示：【指令】+ 稳态四值状态段 + 事件清单（默认 30 行）+ pack 注入（`EventsPackMemory` 存档每次唤醒时事件快照，maxPacks 12 / injectPacks 2），以及元工具集（`tools.ts`）：`send_reply`（≤5 段、单段 2000 字符）/ `stay_silent` / `get_event_history` / 可选 `add_reaction`（onebot `internal.setMsgEmojiLike`）+ trigger 自管理工具（admin 白名单或 koishi authority≥3 可用）。**execute 钩子** `executeWakeArtifact()`：先执行状态计划（homeostasis/memory/bond 更新请求），再 emit `behavior.instruction`（含 agentic tools，交给 dialogue）。

**定时触发器**：`TriggerManager` 是唯一定时引擎（SchedulerService 已于 2026-09 整体退役），任务仓储 memory/mongo 双模式（集合 `elysia_trigger_tasks`）。`enableReply` 是出声总闸。

## 5. 状态子系统：账本、记忆、羁绊、稳态、人格

五个旁路子系统全部事件驱动，不阻塞主链，在下次唤醒时注入 prompt。

### 5.1 cognition —— 事件账本（非显著性打分）

`CognitionService.ingest(stimulus, lifeId)`：合成触发刺激不入账（防自循环）；经 `stimulusToTriggerEvent()` 派生 **11 种目录事件**（message / mention / reply / direct-message / member-added / member-removed / reaction / bot-sent / system.command.executed / system.instant.sent / system.trigger.fired），受 `enabledEvents` 过滤后写入 per `lifeId:habitatId` 的 `EventHistory`（BoundedCache 上限 300 作用域）。`buildFeed()` 产出事件清单行（`[HH:mm:ss] 标签 | 正文`）供唤醒注入。**"接收 vs 呈现"两层开关**（enabledEvents / feed.include）；feed maxEvents 30、history maxEvents 100 / windowMs 30min。旧的 salience 显著性打分已随 2026-09 Wave 3 死代码清理移除。

### 5.2 memory —— 长期记忆

- **写入**：`DeterministicMemoryAttributor` 归因（ownerType 推断链 global>event>thread>habitat>actor>projection>life，relations 自动挂 subject/participant/location）→ 同 stimulusId+kind+owner 去重合并（importance/confidence 取 max）→ `enforceMaxEntries()`（只计 active，溢出按 importance asc 归档——"活跃记忆被清空"的 P0 修复）。
- **检索**：`RuleBasedMemoryContextProvider` 多路候选（actor/thread/habitat/global/relation/text 各 50 条）→ `scoreEntry()` 打分：importance×0.35 + owner 匹配 0.15–0.25 + relation 0.15 + 文本重叠 ≤0.2 + 30 天 recency ≤0.07。
- **可见性**：global / habitat / shared（线程限定不泄漏）/ private。`AiAssistedMemoryRelevanceSelector` 已实现但未接线（回落规则版）。
- **Mongo 版**：查询全部下推 + 3 倍放大窗口内存精滤、`$inc` 原子自增 accessCount、6 个索引。

### 5.3 bond —— 五维羁绊

`Bond.metrics`：familiarity / intimacy / trust / tension / dependence（0–1）。增量策略 `resolveDelta()`：显式 delta 或按 sentiment 推导——negative（familiarity +0.01·scale、trust −0.02·scale、tension +0.03·scale）、positive（三升一降）、neutral（微升）；scale = 0.5 + deltaSuggestion。新 bond 初始 familiarity 0.1 / intimacy 0.05 / trust 0.1；interactionCount 累加。检索打分：actor 目标 0.35 / thread 0.2 / habitat 0.15 / projection 0.12 + 正向关系指标 ≤0.25 + tension ≥0.3 谨慎加成。

### 5.4 homeostasis —— 内稳态四值

energy / mood / sociability / curiosity（0–1；旧第五值 responseThreshold 门控已整链删除）。动力学：tick 挂 `projection.routed`（只对被路由生命体；合成/系统刺激跳过防自我放大）→ `relaxTowardBaseline()` 朝静息基线松弛（高于基线按 decayRate 衰减、低于基线按 recoveryFactor 恢复、不越界振荡）→ emit `homeostasis.updated`。**只注入不门控**：behavior 维护快照缓存注入唤醒提示（"你当前的状态"段，交 LLM 自主把握分寸），不参与唤醒判定；正向回升经 `behavior.homeostasis.update.requested`。`life.loaded` 时从 `life_states` 集合恢复或初始化。

### 5.5 persona —— 人格注册表

监听 `life.loaded`：从 manifest 实例的 `extensions.persona`（name/systemPrompt/traits/tone）解析注册；无扩展且 `registerDefaultPersona=true` 时用插件默认人格（默认关）。brain 每次 execute 按 lifeId 读取拼进 system prompt。

## 6. 对话与大脑

### 6.1 dialogue —— 上下文编排

挂 `dialogue` 阶段钩子（读共享上下文的 instruction，单轨），`DefaultDialogueService.execute(task)`：

- **上下文组装**：`conversationStore.getRecent(scopeKey, memoryLimit=10)` 对话史 + memory 上下文 + bond 上下文 + 当前唤醒全文作为最后一条 user 消息。**对话史只落一行摘要**（`metadata.historySummary`，防事件清单重放稀释）；沉默也入史（`（保持沉默）`）。
- **agentic 分支**：`metadata.agentic` 存在时走 `runBrainToolLoop()`；输出三态（显式沉默 / 发言 / 默认沉默），沉默不产生 output，多段发言每段一条 `dialogue.output.created`（outputId 加段序号）。
- 事件序列：`dialogue.task.created → generation.requested → started → generated → output.created → completed/failed`。

### 6.2 brain —— prompt 组装与工具循环

- **systemPrompt 优先级**：`request.systemPrompt` > persona（`buildPersonaSystemPrompt()`：systemPrompt + Traits + Tone）> 插件 config 兜底；再拼记忆上下文（含 score/reason 清单）与羁绊上下文（五维指标行）。
- **上下文预算治理** `DefaultContextBudgetPlanner`：maxMemoryChars 4000 / maxBondChars 3000 / maxPersonaChars 2000 / maxSystemPromptChars 12000，tokenEstimateRatio 4，超限截断附 governance 后缀；`truncateMessages()` 按 contextWindow(20) 截断。
- **工具循环** `runBrainToolLoop()`：默认 6 轮；未知工具返回结构化错误不中断；每轮剥离重复 system。
- **无流式**：gateway 是请求/响应单发，协议包的 SSE 流解码器全部 export-only（明确非目标，§13）。

## 7. 协议栈：Maheshvara IR 与五协议包

协议栈以 Go 上游 `Elysia-API/Elysia-Api`（tag v1.4.0，2026-09-19）为权威逐函数/逐字段移植，各文件头注释标注对应 Go 文件（如 `backend/relay/maheshvara_types.go`）。

### 7.1 maheshvara —— 统一中间表示（8 文件，约 1,500 行）

| 文件 | 职责 |
|---|---|
| maheshvara.ts | 核心 IR 类型（请求/消息/部件/工具/响应/流事件） |
| errors.ts | 错误协议转换（§7.2） |
| sse.ts | 传输无关 SSE 解析器（增量 push/end、CRLF 分片容错、行长 16MB 上限） |
| parts.ts | 多模态部件中立转换（interfaceToContentParts、parseDataURL、usageFromRawMap 多键名兜底） |
| reasoning.ts | 推理密文信封 v1/v2（`maheshvara-reasoning-v2:` 前缀、跨供应商签名门控） |
| accessors.ts / constants.ts | 防御式取值工具 / 线制与内容类型常量表 |

- **方向性约定（全栈统一）**：`encode` = Maheshvara → 厂商 wire（请求出向）；`decode` = 厂商 wire → Maheshvara（响应入向）。**X→Maheshvara 的请求解码方向刻意不做**（那是 relay 服务端接收客户端请求的场景，TS 侧只做 encode 请求 + decode 响应）。
- **请求**：`MaheshvaraRequest`（messages 与 input_items 双形态；采样参数齐全；tools/tool_choice/response_format/reasoning/thinking/safety_settings；未知字段进 `RawExtra` 保真往返）。
- **响应**：`MaheshvaraUsage` 三段必有 + 缓存分桶 5m/1h + 模态分桶 text/audio/image + estimated 系；`MaheshvaraError` 的 `class` 是稳定分类，type/status/code 由它派生。
- **流**：`MaheshvaraStreamEvent`（Responses 风格事件名）；公开工具 `deltaVsAccumulated`（终块快照差分）。

### 7.2 错误协议层（"协议引擎数据化"的核心）

八类 `ErrorClass`（稳定分类，全栈权威）：`invalid_request / authentication / permission / model_not_found / rate_limit / overloaded / upstream / server`。

- `errorClassHTTPStatus(class)`：八类 → 400/401/403/404/429/503/502/500。
- 三线渲染派生：`openAIErrorTypeCode` / `anthropicErrorType`（overloaded→529）/ `geminiErrorStatus`（gRPC 码）。
- **`parseUpstreamError(upstreamFormat, status, body)`**：按上游线制解 message/type/code → `classFromOpenAIType/classFromAnthropicType/classFromGeminiStatus/classFromStatus` 反推分类 → 失败兜底 `upstreamErrorSummary`（240 字符截断）。OpenAI 分支不按 error.type 分类——忠实保留 Go 上游行为（OpenAI 已废弃 type 细分）。
- 辅助：`sameErrorEnvelope`（OpenAI 家族共用信封可透传）、`MAX_UPSTREAM_BODY_BYTES = 64MB`。

### 7.3 四家内置协议包

统一 `encode.ts / decode.ts / stream.ts` 三文件结构，类型全部来自 maheshvara：

| 包 | 端点 | 能力要点 |
|---|---|---|
| protocol-openai | `{baseURL}/v1/chat/completions` | 工具调用（有状态流式参数拼装）、多模态（image_url / input_audio 仅 wav·mp3 / video_url / file）、annotations 透传、`RawExtra.max_tokens_field` 回写 `max_completion_tokens`（o 系）、OpenRouter 风格 reasoning_details 兼容解析 |
| protocol-anthropic | `{baseURL}/v1/messages` | `CLAUDE_DEFAULT_MAX_TOKENS=65536` 强制 max_tokens；thinking 自适应（Claude 4.5 adaptive + output_config.effort）/ 预算式（开思考强制 temperature=1 去 top_p）；system 块数组原样回放保 cache_control；citations；P0-5 角色交替修复 |
| protocol-gemini | `{baseURL}/v1beta/models/{model}:generateContent` | thought 谓词分流（thought:true→reasoning）；functionCall args 完整对象一次性 done；grounding annotations；跨供应商 thought 签名 |
| protocol-responses | `{baseURL}/v1/responses` | item 级输入（input_items）；类型化事件流；incomplete_details.reason 归一 finish reason |

### 7.4 protocol-custom —— 协议即数据引擎（13 文件，约 3,900 行）

对齐 Go v1.4.0 custom_protocol 引擎，让"接一个新供应商"变成"写一份 JSON"：

- **Match 原语**（match.ts）：`{path, op?, value?}`，15 个操作符（nonEmpty 缺省 / isEmpty / equals / notEquals / in / notIn / contains / isNull / notNull / isTrue / isFalse / gt / gte / lt / lte），类型化相等（数字按值、对象按规范 JSON），数组=AND。
- **注解树编译**（compile.ts + template.ts）：`request.body` 是"结构即配置"树——容器为普通 JSON，叶子为 `{field, mode?, default?, omitIfEmpty?, when?}` 或常量 `{value}`；编译成 `{{maheshvara.xxx}}` 模板（支持 `|default:` 过滤器；上限 4MB/64 层/2048 占位符）。
- **响应映射**（response.ts + schema.ts）：textPath/textFilter、reasoningPath、toolCallsPath、usagePath、finishReasonPath、errorPath + 键名别名表（如 Anthropic `input`→arguments）；23 种 transform（identity/raw/string/join/int/bool/json/timestamp_ms/first/usage/content_parts/tool_calls/output_items…）。
- **流帧解码**（stream.ts）：帧匹配（SSE event 名或谓词）→ 帧级 response 映射 → text/reasoning/arguments 三族独立 delta/cumulative 差分 → Maheshvara 流事件；tool 规则拼装"身份帧 + 参数帧"。
- **四个内置 preset**（presets.ts，TS 内联）：`openai-chat` / `anthropic-messages` / `gemini-generate` / `openai-responses`。**对拍测试**（presets.test.ts，11 用例）：同一 SSE fixture 分别喂 preset 解码器与内置解码器，断言 text/reasoning/toolArguments/finish_reason/usage 全等。
- `validate.ts` 注册期一次性整体校验（含双模板渲染），非法配置启动即报错；`registry.ts` 提供注册热路径。

## 8. 模型网关

### 8.1 Provider + Slot 两层

- **Provider 层**（怎么连 API）：`Provider { id, descriptor, execute(ProviderRequest) }`。内置五种（`createProvider` 工厂）：chat-completions / responses / gemini / anthropic / custom。**没有独立 OpenRouter provider**——OpenAI 兼容线走 chat-completions。
- **Slot 层**（这个用途用哪个模型）：`Config.providers`（provider id → type/apiKey/baseURL/endpoint/protocol/maxTokens/temperature/timeoutMs/**maxTokensField**）只是配置源；`Config.providerSlots`（slot 名 → provider + model? + maxTokens?）才注册成 `slot:<name>` 实例。`GatewayRouter.resolve` 优先 slot 命中，其次 defaultSlot。
- **custom 供应商**：provider 的 `protocol` 字段经 `resolveProtocolDefinition` 解析——**`Config.protocols` 字典优先，其次内置 preset id**（校验白名单 `PRESET_PROTOCOL_IDS`）。
- **maxTokensField**：`'max_tokens' | 'max_completion_tokens'` → 写入 `RawExtra.max_tokens_field` → protocol-openai encode 时改写请求字段名。

### 8.2 请求路径（`DefaultModelGatewayService.execute`）

1. emit `gateway.requested` → `resolveCandidateSlots`（主 slot + fallback 链）→ `GatewayRouter.resolve` + 路由诊断。
2. `executeWithRetry`：熔断可用性检查 → `provider.execute`：DialogueMessage → `toMaheshvaraRequest` → 协议包 `encodeXxxRequest` → `fetchWithTimeout`（AbortController，**响应体读取也在超时保护内**）→ 非 2xx 经 `parseUpstreamError` 得真实 message + class → `decodeXxxResponse` → 提取文本与工具调用。
3. 成功 emit `gateway.responded`（带 diagnostics + healthSnapshots）；全链失败 emit `gateway.failed` + 抛 `all-fallbacks-failed` 聚合错误。

### 8.3 重试 / 熔断 / 回退

- **class 驱动重试**（`providerErrorRetryable`，class 是权威）：rate_limit / overloaded / upstream / server 可重试；authentication / permission / model_not_found 不可；invalid_request 仅 408/409/无状态码可重试（防重试风暴）。
- 退避：maxRetries 3、baseDelayMs 500、maxDelayMs 5000 指数退避。P2-10 修复：200 返回 HTML 的解析错误不再白重试（转 invalid-response 不可重试）。
- **熔断** `ProviderHealthTracker`：连续失败 ≥3 开闸，冷却 30s 后半开探针；状态机 healthy/degraded/unhealthy/circuit-open；`lastErrorClass` 记录分类。P2-9 修复：一次请求内多次 attempt 只计一次熔断失败。
- **回退**：`FallbackConfig.slots` 槽位链，circuit-open / 可重试错误 / 配置允许的不可重试错误触发。

**错误分类贯穿全链**：`ProviderError.class` → `GatewayAttemptDiagnostics.errorClass` → `ProviderHealthSnapshot.lastErrorClass` → observatory `GatewayAnalytics.byErrorClass`。

### 8.4 调试命令（authority 4）

`elysia.gateway.slots` / `elysia.gateway.registry` / `elysia.gateway.health [providerId]` / `elysia.gateway.failures [limit]`（failures 从 observatory 拉 `gateway.failed` 事件）。

## 9. 观测（observatory）

- **纯内存环形缓冲** `ObservatoryStore`：records 数组 + byStimulus 索引，maxRecords 默认 500 截断。**自身不落任何库**（`repository.*` 事件只是被观测记录）。
- **订阅**：优先 `eventBus.onAny` 通配订阅全部事件，旧总线回退约 50 个事件的枚举表。
- **脱敏** `sanitizePayload`：apikey/token/authorization → `[Redacted]`；content/text/prompt 等自然语言字段只留长度/数量；深度限 4、环检测。
- **聚合**：`GatewayAnalytics`（byProviderId / **byErrorClass** / byErrorCode / byFallbackSlot、failedOverCount、circuitOpenCount）、`GatewayFailureRecord`（errorClass、fallbackChain、retryCount）、`OperationalSnapshot`；`runtime.trace.completed` 进独立 trace 环形缓冲。
- **命令**：`elysia.status` / `elysia.gateway.status` / `elysia.repository.status` / `elysia.trace.recent [stimulusId]`（authority 3）、`elysia.preflight`（authority 4）。

## 10. 数据层

**全 monorepo 无任何 `ctx.model.extend`**——持久化完全不走 Koishi ORM（minato），而是原生 MongoDB 集合，经 runtime 的 `elysia.persistence` 服务分发句柄（`getCollection()`）：

| 集合 | 使用方 | 内容 |
|---|---|---|
| `life_states`（可配） | homeostasis | 四值状态（stateType 默认 homeostasis；唯一索引 lifeInstanceId+stateType） |
| `elysia_projection_rules` | runtime | 投影路由规则（启动时恢复） |
| `elysia_memories` | memory | 长期记忆（6 索引） |
| `elysia_bonds` | bond | 羁绊关系（4 索引） |
| `elysia_trigger_tasks` | behavior | 定时触发器任务 |

数据库默认名 `elysia_ai`。**memory 模式下一切退回进程内 Map（重启即丢）**——这是当前宿主的实际运行形态（§11.3）。

> 全部集合的字段级设计（预备知识讲解、逐字段表与示例数据、索引定义、查询下推矩阵、claim 抢答机制、未持久化状态清单、设计取舍）以通俗风格展开于独立文档：[elysia-ai-database-schema.md](elysia-ai-database-schema.md)。

## 11. 配置面与运行现状

### 11.1 manifest.json（生命体定义）

由 `elysia-ai-runtime` 插件加载（Config.manifestPath），结构（模板见仓库根 manifest.example.json）：顶层 `version` + `lifeInstances[]`，每项 `id / type: elysia-default / enabled / meta.name / extensions`；extensions 按插件 configNamespace 隔离，示例含 `persona`（name/systemPrompt/traits/tone）与 `projection.rules[]`（id/enabled/priority/platform/habitatId 或 channelId）。加载时逐项校验（id 非空去重）→ 注册生命体/人格/投影规则 → `auditCompatibility()` 告警式审计。

### 11.2 命令与文案

全框架 13 条 koishi 命令：behavior 4 条 `elysia.trigger.*`（authority 3）、observatory 5 条（§9）、model-gateway 4 条（§8.4）。locales **只有 zh-CN**（12 个插件有，body 与全部 scoped 包无）。

### 11.3 宿主实际运行形态（koishi-elysiaAI 工作区，2026-10 时点）

- 13 个 elysia 插件全部启用：runtime 指向 `data\elysia-ai\manifest\default.json`；model-gateway 配 provider `moyuu`（type gemini、baseURL https://moyuu.cc、maxTokens 128000、timeoutMs 360000）+ slot `main`（gemini-3.6-flash、temperature 0.7）；brain defaultModelSlot=main；memory maxEntriesPerLife=100；behavior directWindowMs=2500；persona 默认名 roza + 长篇人设；其余空配置。
- 实际 manifest：1 个生命体 `roza`（含完整人设与 traits）+ 1 条投影规则（onebot、habitatId 517086112）。
- **mongo 未启用**（database-mongo 禁用、无 mongo.uri）→ memory/bond/trigger/状态仓储全部运行在**内存模式**；宿主 sqlite（data/koishi.db）里只有 Koishi 核心表，无任何 elysia 表。
- 所有平台 adapter（onebot/discord/telegram 等）处于禁用状态；chatluna 两插件禁用。data/logs/ 有约 40 个日志文件（2026-07-31 至 2026-08-29）——即上一次真实运行停在 8 月底。
- 宿主根 README.md 是面向首次配置用户的《配置教程》（三核心概念：生命体 / 处理链路 / Provider+Slot 两层），monorepo readme.md 是构建与 npm 说明。

## 12. 项目状态：版本、发布与演进史

### 12.1 版本与发布矩阵（npm 核验于 2026-10-09）

| 分组 | 仓库版本 | npm 现状 |
|---|---|---|
| 协议栈：maheshvara、protocol-openai/anthropic/gemini/responses/custom、model-gateway | 0.3.0 | **已发布 0.3.0** |
| brain、observatory | 0.2.2 | 已发布 0.2.2 |
| core、shared | 0.2.1 | 已发布 0.2.1 |
| kernel | 0.1.1 | 已发布 0.1.1 |
| 13 个插件 `koishi-plugin-elysia-ai-*` | 0.2.2 | **全部已发布 0.2.2** |

2026-09-19 交付的 22 包单行发布命令**已由用户执行完毕**，npm 与仓库版本一致（此前协议系停在 0.2.1 的状态已翻篇）。插件是 esbuild bundle，升级需先 turbo 重建再发布。

### 12.2 git 状态

monorepo 最新提交 `39b08ca feat!: 同步 elysia-api 深度更新并更名 canonical → maheshvara（v0.2.0）`；**工作区存在大量未提交改动**——2026-09 的触发器重构、Wave1–3 修复、SchedulerService 退役、版本 bump 至 0.3.0/0.2.2、docs 更新（含删除 phase10/11/12/18 等过时测试）都还停在暂存/工作区，未形成提交。npm 发布先于 git 提交完成。

### 12.3 与 Go 上游 Elysia-Api 的同步状态

- 上游位置：`D:\DevProjects\Elysia-API\Elysia-Api`，协议层在 `backend/relay/`，四 preset JSON 在 `backend/server/presets/`；版本 tag v1.4.0。
- **v1.4.0「协议引擎数据化」已全量同步**（2026-09 完成）：maheshvara + 四协议包 0.3.0（错误协议层、max_tokens_field 回写、claude_system_blocks 回放、legacy functions 分流、disable_parallel_tool_use）+ protocol-custom 0.3.0（preset 与内置解码器有对拍测试）；gateway 跟进 0.3.0（错误分类接入、custom 供应商、maxTokensField）。
- 转写原则：逐函数/逐字段对齐，**含 Go 的怪癖零值行为**（如 OpenAI 不按 error.type 分类）。
- **Go 侧有、TS 侧刻意不做的方向**：流渲染器（maheshvara→线制 SSE，relay 服务端专用）、SSE 排水迭代器 ForEachBatch、backend/agent 未跟踪包、X→Maheshvara 请求解码方向。

### 12.4 演进史（从测试与文档命名还原）

phase1–45 阶段验收 → 2026-06 全项目代码审查（docs/elysia-ai-review-2026-06.md，A 类"没建到"/B 类"建成但写错"分类法；元发现："368 个测试全绿却没测出中文主路径失效"）→ D1–D3 持久化生产化 → R0–R3 审查修复 → 2026-08-19 全项目审查（known-issues：P0×5 + P1×10 修复）→ 2026-09 触发器三层分发重构 + Wave1–3 + v1.4.0 协议同步 + gateway 0.3.0。文档资产 15 篇 6,762 行（顶层设计、core 契约、路线图、Koishi 集成指南、插件开发指南/规范、事件参考、日志规范等）。

## 13. 已知问题与设计取舍

### 13.1 已知问题账本（docs/elysia-ai-known-issues-2026-08.md，含 2026-09 追加）

P0×5 与 P1×10 已修复（bot 自言自语死循环、scopeKey 不一致、Mongo 仓储未接线、活跃记忆被误清空、anthropic encode、按 habitat 串行化等）。**P2×24 项低危待办**按域分组：

- **body/主链**：stimulus.id 无平台命名空间（多 bot 撞 id）；OutboundRouteRegistry FIFO 非 LRU（高流量下回复静默丢失）；threadId=replyToMessageId 语义滥用；outputId 多 life 冲突。
- **model-gateway/protocol**：gemini key 走 URL query 未编码；anthropic 流式 usage 需消费端合并；协议间工具 arguments 类型不一致等约 10 项。（注：该清单定格于 2026-08；此后 gateway 0.3.0 深改已顺带修复部分条目——如 fetchWithTimeout 已保护到响应体读取——文档未逐项回溯标注。）
- **runtime/状态层**：observatory 脱敏 DAG 误判循环；homeostasis 衰减按事件次数而非时间（P2-19，部分缓解）；多进程无防重。
- **工程质量**：多处源文件 GBK/UTF-8 双重编码乱码注释；路线图正文大段乱码（P2-23）；docs 引用已删 API（如 preflightMemoryConfig）。

### 13.2 明确非目标（"明确不修"清单）

- **流式 SSE 接入**：gateway 请求/响应单发，全部流解码器 export-only（换实现简单与稳定；长任务受 timeoutMs 约束）。
- **自定义协议模型发现端点**未接 koishi 命令。
- **brain/dialogue 用户可见错误文案**：链路吞错入日志（`sendErrors` 类机制不存在）。
- **多进程分布式锁**（单进程假设）。
- **时间驱动的状态衰减**（homeostasis 按事件 tick）。
- **AiAssisted 选择器槽位接线**（规则版够用）。

### 13.3 核心设计取舍

- **双层包结构**：逻辑全部宿主无关化（可单测、可复用），代价是 34 包的版本协同与"逻辑库进 devDependencies"的构建技巧。
- **配置即全部**：生命体在 manifest.json、凭据在 koishi schema；数据库只存运行时状态（且当前宿主实际跑内存模式）。
- **协议权威在 Go 上游**：TS 忠实转写（含怪癖），换取的是上游演进可直接镜像；代价是 TS 侧无法独立偏离。
- **观测是内存态**：重启清空，环形缓冲截断——生产排障依赖当时在场。
- **状态注入而非门控**：homeostasis/记忆/羁绊影响 prompt 内容，不硬性拦截唤醒路径——行为"软决定论"，调试简单但不可精确复现。
- **无 Koishi ORM**：Mongo 原生集合换查询下推与索引自由，代价是与 Koishi 数据面（控制台数据表、sqlite 宿主）完全隔离。

---

*数据快照：2026-10-09。git HEAD `39b08ca` + 未提交工作区；npm 版本当日核验；宿主运行形态来自 koishi.yml 与 data/ 实况。事实来源：三路代码勘查（工程全景 / 协议栈与网关 / 运行时插件链）+ 关键文件复核（`packages/@elysia-ai/core/src/pipeline/index.ts` 等）。*
