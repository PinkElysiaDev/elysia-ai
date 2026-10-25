# Elysia A.I. 已知问题清单（2026-08 审查）

本清单来自 2026-08-19 的全项目代码审查（主链路 / 运行时持久化 / 模型网关协议三层）。
**P0（5 项）与 P1（10 项）已在本轮修复并附带回归测试**；以下为**暂不修复的低危项（P2）**，
按模块归类，供后续迭代认领。位置均相对 `packages/`。

## 已修复（概要）

| 级别 | 问题 | 修复点 |
| --- | --- | --- |
| P0 | body 不过滤 bot 自身消息 → 自言自语死循环 | `elysia-ai-body/src/adapters/koishi/koishi-body-adapter.ts` |
| P0 | cognition/dialogue 会话 scopeKey 格式不一致 → 连续性信号恒 0 | `@elysia-ai/shared/src/conversation-scope.ts`（新增唯一实现） |
| P0 | Mongo 调度任务/投影规则仓储未接线；loadFromRepository 无调用方 | `elysia-ai-runtime/src/index.ts`、`store/mongo-runtime-repositories.ts` |
| P0 | enforceMaxEntries 把 archived 计入上限 → 活跃记忆被逐步清空 | `@elysia-ai/memory/src/index.ts` |
| P0 | anthropic encode 不合并连续同角色/透传非法字段/tool_use.id 无兜底 | `@elysia-ai/protocol-anthropic/src/encode.ts` |
| P1 | DialogueTask 丢 actorId/habitatId/threadId | `@elysia-ai/behavior/src/action-builder.ts`、`execution-plan.ts` |
| P1 | buffer/followup 三重断裂（桶计数恒 1 / 到期不走路由 / 发送路由缺失） | `bucket.ts`（新）、`runtime.ts`、`sender/index.ts`、`execution-plan.ts` |
| P1 | 崩溃后 running 任务永久丢失 | `scheduler/index.ts recoverInterruptedTasks` |
| P1 | 并发读-改-写丢更新 | `runtime.ts` receiveStimulus 按 habitat 串行化 |
| P1 | cognition 门控依赖插件加载顺序 | behavior 保守跳过 + wrapper 探测 cognition 服务 |
| P1 | responses finishReason 返回生命周期状态 | `providers/utils.ts normalizeResponsesFinishReason` |
| P1 | 音频部件键名/格式错误（audio→input_audio、URL 当 base64、MIME 当 format） | protocol-openai / protocol-responses encode |
| P1 | enableReply 配置无消费逻辑 | `@elysia-ai/behavior/src/index.ts` |
| P1 | Koishi 元素标记未剥离即进感知/LLM | `session-to-platform-message.ts` |
| P1 | memory/bond 本地 Map 无界增长 + 陈旧合并覆盖远端 | Mongo 仓储写后逐出 + 更新前刷新 |
| 附带 | DefaultBrainService 丢失自定义 ContextBudgetPlanner 注入（扁平化重构回归） | `@elysia-ai/brain/src/index.ts` |
| 附带 | 测试基线大面积红：koishi mock 缺 cordis set/get/reflect.alias；测试用旧 provider 类型名/旧配置形状 | `__mocks__/koishi.ts`、30+ 测试文件 |

## P2 待办清单

### body / 主链

1. **stimulus.id 无平台命名空间**（`elysia-ai-body/src/adapters/koishi/session-to-platform-message.ts`）：
   同一 runtime 挂多 bot/多平台时 messageId 撞车 → OutboundRouteRegistry 相互覆盖、缓存踩踏、重复回复。
   建议 id 规范化为 `${platform}:${channelId}:${messageId}` 或 `${platform}:${messageId}`。
2. **OutboundRouteRegistry 是 FIFO 而非 LRU**（`elysia-ai-body/src/sender/index.ts`）：容量 500，高流量群 +
   慢 LLM（timeoutMs 可到 6 分钟）下早期 route 被逐出 → 回复静默丢失；重复 set 不刷新位置。
3. **threadId = replyToMessageId 语义滥用**（`normalize/session-to-stimulus.ts`）：引用任何人的消息都被当作
   "回复 bot"获得 salience 加成，且对话历史被按"被引用消息 id"切割。建议 isReply 仅在引用目标是本 bot
   消息时为 true；threadId 改用平台的真实话题 id。
4. **AI 感知串行阻塞整条链、无并发背压**（`@elysia-ai/perception/src/index.ts`）：开启 aiEnhanced 后一条
   消息的感知 LLM 调用最坏挂 6 分钟，期间整链停摆；多消息并发无队列/限流。
5. **perception mention 实体正则 `@(\S+)` 永不命中**（`@elysia-ai/perception/src/rules.ts`）：Koishi 已把 @
   转成元素；P1-14 剥离后 content 中会再现 `@name` 文本，此正则可能开始命中，但其捕获的是剥离后的展示名
   而非用户 id，语义需要重新设计（可消费 `payload.mentionedUserIds`）。
6. **perception maxInputTokens 声明未实现**（`@elysia-ai/perception/src/ai-enhanced.ts`）：超长消息原样进 LLM。
7. **outputId 多 life 冲突**（`@elysia-ai/dialogue/src/index.ts`）：同一 stimulus 路由到多个 life 时
   `dialogue.output.created` 的 outputId 相同，observatory 追踪会混流。建议拼入 lifeId。

### model-gateway / protocol

8. **fetchWithTimeout 只保护到响应头**（`providers/utils.ts`）：`res.json()` 慢速/挂死无限期等待，
   timeoutMs 形同虚设。建议把 body 读取纳入 AbortController 保护。
9. **每次重试 attempt 都计入熔断**（`model-gateway/src/index.ts`）：`maxRetries=3` + `failureThreshold=3`
   时单次请求即可 circuit-open 30 秒，"连续失败"语义被放大。建议按"请求级"而非"attempt 级"计数。
10. **非 ProviderError 一律视为可重试**（`isRetryableError`）：`res.json()` 的 SyntaxError（如 200 返回
    HTML）会重试 3 次并计入熔断。
11. **gemini API key 走 URL query 且未编码**（`providers/gemini.ts`）：密钥进入错误消息/代理日志；`model`
    也未 encodeURIComponent。建议改用 `x-goog-api-key` 头。
12. **anthropic 流式 usage 需消费端合并**（`protocol-anthropic/src/stream.ts`）：message_start 带
    input_tokens、message_delta 只带 output_tokens，以"最后一个 usage 事件"为准会把输入统计为 0。
13. **流式 cached_tokens 不解析**（`canonical/src/parts.ts usageFromRawMap`）：不读
    `prompt_tokens_details.cached_tokens`（非流式路径已处理）。
14. **ChatCompletionsStreamDecoder 工具状态跨 choice 共享**（`protocol-openai/src/stream.ts`）：`n>1` 时
    两个 choice 的同名 index 工具参数互相拼接。
15. **Gemini 流式 content_index 跨 chunk 重置**（`protocol-gemini/src/stream.ts`）：按 chunk 内 partIndex
    编号，消费方按 content_index 聚合会错乱。
16. **responses encode 静默丢弃无 id/name 的 tool call**（`protocol-responses/src/encode.ts`）：丢弃后对应
    function_call_output 失配 → 上游 400。可参照 openai 侧合成 id。
17. **协议间工具 arguments 类型不一致**：anthropic decode 产出对象、openai/gemini 产出 JSON 字符串；
    encode 侧只认字符串，对象参数静默变成 `'{}'`。建议 canonical 层统一为字符串并在 anthropic decode 处
    JSON.stringify。

### runtime / 状态层

18. **observatory 脱敏把 DAG 共享引用误判为循环**（`@elysia-ai/observatory/src/service.ts` sanitizeValue）：
    `seen` WeakSet 递归返回后不清除；同一对象被 payload 两处引用时第二处变 `'[Circular]'`，trace 缺字段。
19. **homeostasis 衰减按事件次数而非时间**：群聊高频时能量秒级衰减到底、完全静默时永不衰减；behavior 层
    可能把 mood 推到负值而 plugin 层 clamp 到 [0,1]，两套值域写者不一致。
20. **调度 tickOnce 用批首陈旧 now 判过期**（`scheduler/index.ts`）：批量执行耗时长时排在后面的任务用旧
    时间戳判断 expiresAt，刚过期几秒的任务仍会执行。影响极小（1s 粒度）。
21. **lazyMongoCollection 缓存被拒绝的连接 Promise**（`@elysia-ai/shared/src/mongo-connector.ts`）：首次
    连接失败后终身瘫痪、close 时 rethrow。当前无调用方（潜伏死代码），启用前需修。
22. **fallback 链对 defaultSlot 请求不生效**（`model-gateway/src/index.ts`）：`request.slot` 为空时即使
    为 defaultSlot 配置了 slots 映射也不走 fallback。

### 工程质量

23. **多处源文件注释 GBK/UTF-8 双重编码乱码**（behavior/runtime/homeostasis/bond/brain 的 index.ts 等）：
    某次提交用错误编码保存；不影响运行但持续污染 diff，建议一次性转码修复。
24. **docs 引用已删除的导出**：`elysia-ai-koishi-integration-guide.md` 仍引用 `preflightMemoryConfig` 等
    已随持久化架构收敛删除的 API。

## 2026-09 更新（Wave 3 批量清理与打磨）

**触发器重构已完成**：behavior 层定型为「三层分发（指令直达 / 即时应对 / 密度合并）+ 定时触发器
（TriggerManager，Mongo/内存双模式仓储）」架构，cognition 收敛为事件注入层（events 变量数据源），
perception 回归纯规则版富化，对话走 agentic 工具循环（send_reply/stay_silent）。

**本批（2026-09-08）修复概要**：

- 死代码清理：删除 BehaviorSignal/BehaviorCandidate/BehaviorDecision/BehaviorActionType 类型与
  BehaviorExecutionPlan 的 decision/selectedCandidate 冗余字段、BrainCapability 死值、NS_COGNITION、
  MemoryUpdateRequest.salience、perception maxInputTokens 死键、behavior/lib 陈旧产物
  （check-source-hygiene 检查范围扩至 lib/ 源失配产物）。
- 事件契约补齐：executeWakeArtifact 发射 behavior.execution.plan.created；Mongo 触发器仓储 CRUD
  失败发射 repository.query.failed / repository.write.failed（经 resolveTriggerTaskRepository 透传 eventBus）。
- observatory：kindFromEvent 补 cognition/projection/perception 分类；statusFromEvent 补
  recorded/routed/fired 动作识别；删除 behavior.selected 死分支。
- 触发器打磨：指令回执接 expandTemplate；userLast 冷却 Map 上限 500 防无界增长；广播任务 manual fire
  也展开（无活跃窗口报 no active habitats）；update/enable/resume 重排保留 runCount/lastRunAt；
  executeWakeArtifact 对 behaviorExecution.execute 加 try/catch；定时/批量唤醒 trigger 工具降为只读
  （actor 归因错配防护）。
- 对话打磨：多段发言 outputId 加段序号；silent 决策时对话历史写「（保持沉默）」；
  add_reaction 缺省目标改用最近 message 组事件 id（不再误用合成 stimulus id）。
- behavior 小修：fireTrigger 路径不再覆盖 scope.isDirect；harvest 加 async 互斥。
- 文档/乱码：dialogue/homeostasis/perception 的 GBK 乱码分隔线注释转正；事件目录与
  elysia-ai-behavior zh-CN locale 更新为现行配置形状。

**P2 清单状态**：P2-4（AI 感知串行阻塞）与 P2-6（maxInputTokens 声明未实现）已失效——感知层
aiEnhanced/maxInputTokens 已随触发器重构整体移除；P2-19（homeostasis 衰减按事件次数而非时间）
部分缓解——homeostasis tick 跳过合成触发刺激，衰减不再被触发唤醒放大；其余 P2 项状态不变，
**协议层清单（model-gateway / protocol-*）完全不变**。

**新增后续项**：

1. ~~**scheduler 与 TriggerManager 双循环合并**~~ **【已完成，2026-09】**：SchedulerService 已整体
   退役（followup 任务类型无生产者、纯死链），runtime 不再构造调度循环与 Mongo 调度任务仓储；
   TriggerManager 是唯一定时引擎，misfire/防重入/持久化策略不再有两套。
2. **时间驱动衰减**：homeostasis（以及记忆 decay 若启用）应按墙钟时间而非事件次数驱动，消除
   P2-19 的根因（高频群聊加速衰减、完全静默永不衰减）。
3. **多进程防重**：TriggerManager harvest 为进程内互斥；多进程部署（或 Koishi 多实例共享同一 Mongo）
   会重复点火。需要分布式锁（Mongo 原子占位或租约）后再考虑水平扩展。

**2026-09 追加处置：P2-19 已处置（homeostasis 只写不读问题）**：

- **读路径复活**：homeostasis 四值状态（energy/mood/sociability/curiosity）此前只写不读（门控读路径
  已随触发器重构删除）。现经 behavior 的 `getHomeostasis` 注入口把状态注入唤醒提示（"你当前的状态"
  段，位于事件清单之前），交 LLM 自主调节回复分寸——不回门控、不硬性拦截。
- **responseThreshold 死链删除**：五值中的 responseThreshold 无任何读取方（原门控消费者已删），
  整链移除：homeostasis/core 类型与 schema、runtime HomeostasisUpdateRequest delta、
  behavior execution-plan 的 delta 字段、koishi 插件 Schema 的 responseThresholdMin/Max 配置键。
- **衰减 tick 已跳过合成刺激**（此前完成）：合成触发刺激与系统事件不驱动衰减，衰减不再被
  触发唤醒自我放大。剩余的时间驱动衰减问题见上方后续项 2。

**2026-09 追加处置：SchedulerService 退役（双循环合并完成）**：

- followup 是 SchedulerService 唯一的任务类型且已无生产者（schedule-followup action 分支删除），
  整链退役：runtime DefaultSchedulerService/Memory 与 Mongo 调度任务仓储、`core/types/scheduler.ts`、
  `core/repositories/scheduled-task.ts`、event-map 的 `scheduler.task.*` 六事件与
  `behavior.followup.scheduled`、observatory 观测清单对应项、phase18 调度测试。
- TriggerManager 为唯一定时引擎（上方后续项 1 勾销）。原文档中引用 `scheduler/index.ts` 的条目
  （P1 表"崩溃后 running 任务永久丢失"、编号 20"tickOnce 陈旧 now"）已随之失效。

**2026-09 追加处置：第二轮修复基线（Wave 1 P1×5 + Wave 2 P2×10 + Wave 3 P3 批量）**：

- **Wave 1（P1×5）**：wrapper 装配下默认即时规则生效（空数组不再短路）；receiveStimulus 的 priority
  透传（instant 插队 0 / 批量定时 1）；定时任务 routing 持久化并在 fire 时传递（冷启动发送恢复）；
  RouteMessageSender 直发兜底；claim 失败不整写收割快照（僵尸任务不复活）。
- **Wave 2（P2×10）**：
  - P2-16 半修复收口：空 tool_call_id 的 tool 消息按前序 assistant 合成 id（`call_${msgIndex}_${callIndex}`）
    FIFO 回填配对（responses/openai encode 双侧），无命中再降级 user 文本；responses encode 的
    function_call_output 输出改读 tool_output 部件载荷（此前桥接 tool 消息输出恒空串）。
  - trigger 工具读操作收紧：非 admin list 只见本 habitat（含广播）、get 跨 habitat 返回 forbidden；
    resume 不再隐式 enable（disabled 任务报错不复活）；list limit 0/负数回退默认 20；
    pause_until 描述注明不清除 enabled；update 的 task 描述去掉不支持的 habitatId。
  - 即时冷却按 habitat 隔离（`ruleId:habitatId` 键）；默认即时规则（被@必应/私聊必应）加 3s 冷却防刷屏。
  - 唤醒归因：fireTrigger 把点火时刻 lastEvent 锁定进 `metadata.wakeActor`（trigger 工具权限优先用它，
    防 cognition 滚动窗口推进后归因漂移）；非 instant 唤醒的 memory/bond/dialogue actorId 置空落 habitat 档；
    空 lifeId 哨兵根治（解析失败 warn 并跳过点火，广播路径不受影响）。
  - send_reply 上限：段数 5 条、单段 2000 字符截断附省略号。
  - wrapper apply 时刻服务缺失显式告警（cognition warn / body、homeostasis info）。
- **Wave 3（P3 批量）**：observatory 恢复 body kind、statusFromEvent 取事件名末段、sanitize seen 后序
  移除（DAG 不误判 Circular）、scheduledTaskId 死字段与 result.scheduledTask.* 死路径删除；homeostasis
  桥 read-through 带 timestamp 比较 + runtime 旧文档退役字段剥离（normalizeState 只挑已知字段）；
  bot-sent 内容纯文本化（复用 elementToPlainText）；合成触发刺激跳过 perception 分析；空快照不记 pack；
  announceSystemEvent id 加序列后缀；memory shared 线程记忆不泄漏到 habitat 级、archived 不再被 merge
  复活、execution-plan memory scope 提示对齐 ownerType（habitat）；MemoryConversationStore 外层 scope
  300 上限；TriggerManager pause 到期恢复保留 runCount、运行中写竞态防御（最终 save 前重读，
  非 running 放弃写）；memory-update 失败不再恒 completed（按 planId/actionId 关联 memory.update.failed）；
  locale 死键清理（homeostasis/cognition/perception/bond/memory）；core-contracts/top-level-design 的
  scheduler 与 responseThreshold 失效段标注或删除；core/lib 孤儿 scheduler 产物删除。
- **本轮明确不修（后续认领）**：~~Mongo 仓储全量拉取性能（query 无过滤下推）~~ **【已完成，2026-09】**
  （见下方"2026-09 追加处置：Mongo 查询下推与索引对齐"）；多进程部署下 memory/bond
  的读-改-写竞态（同 TriggerManager 多进程防重项）；perception 直连 cognition feed（当前经事件间接）；
  AiAssisted 选择器的模型槽位接线（当前回落 rule-based）；tool-loop 对 TypeError 的重试白名单过宽；
  behavior wrapper 服务懒解析（当前 apply 时刻解析 + 告警，加载顺序依赖插件声明）。

**2026-09 追加处置：Mongo 查询下推与索引对齐（Phase B-D 完成）**

- **memory 直查（B）**：MongoMemoryRepository 的 query/listByLifeId 不再走 scopedByLife
  "按 life 拉全量子集再内存过滤"，改为 filter/sort/limit 单次 findMany 下推——等值
  （actor/habitat/thread/projection/owner/event/stimulus 等）、$in（scope/kind/ownerType/
  visibility/status）、$gte/$lte（minImportance/minConfidence/createdAfter/Before）、
  $elemMatch（relations）全部服务端完成；listByStimulusId 补 status $ne deleted 与
  createdAt 倒序下推。**text 子串与 tags 大小写不敏感 ALL 语义无法精确下推**（$in 是
  大小写敏感的任一命中，会把 'Prod' 排除在 ['prod'] 之外）：拉取 3 倍放大窗口
  （limit+offset）后内存精滤再截断，命中集超过放大窗口时 total/尾页可能偏小（既定取舍，
  无生产消费方依赖全量 total）。MemoryMemoryRepository（内存部署的查询引擎）不动。
- **enforceMaxEntries 计数化（B3）**：新增可选能力接口 MemoryEntryCapacityRepository
  （countActiveByLife / listOverflowingActiveByLife，服务层鸭子类型探测）：Mongo 走
  countDocuments + 超限时只拉 count-max 条溢出集（importance asc, createdAt asc），
  取代 maxEntries+1000 窗口全拉；内存仓储为过滤计数；第三方仓储自动回退旧路径。
- **bond 直查（C）**：query/listByLife 同模式下推（含 minFamiliarity 等五维 $gte、
  updatedAfter/Before、targetType 归一化别名 $in——individual→actor、collective/channel→habitat）；
  getByLifeAndTarget 单次 findOne 直查（status $ne deleted + 别名 $in），删除未命中的
  scopedByLife 全拉回退分支。interactionCount 读-改-写不改（既有已知项）。
- **触发器收割直查（D）**：TriggerTaskRepository 接口新增 listDue(now)——Mongo 下推为
  enabled + $or（waiting 到期 / paused 恢复点到期）单次查询（nextRunAt 升序，对齐
  _harvest 复合索引），memory 为进程内过滤；TriggerManager.harvest() 改用 listDue，
  不再全量 query() 后内存过滤（start() 的重启恢复仍需全量快照：error 复活与
  nextRunAt=null 修复不在"到期"定义内，且仅启动时执行一次）。countByOwner 改
  countDocuments；投影规则 listEnabled 改 findMany({'rule.enabled': {$ne: false}})，
  不再全量拉取后内存筛选。
- **新索引清单（ensureIndexes 启动时自动创建，幂等）**：
  - elysia_memories：`_life_created`（保留）、`_stimulus`（保留单字段——listByStimulusId
    无 lifeId 维度，lifeId 前缀复合无法服务该形状）、新增 `_life_status_owner`
    ｛entry.lifeId, entry.status, entry.ownerType, entry.ownerId, entry.createdAt↓｝、
    `_life_importance`｛entry.lifeId, entry.status, entry.importance↓｝、
    `_relations`｛entry.relations.targetType, entry.relations.targetId｝；
  - elysia_bonds：删 `_target`（被新复合覆盖）、保留 `_life_updated`（默认 updatedAt
    排序无新复合可替代）、新增 `_life_status_target`｛bond.lifeId, bond.status,
    bond.targetType, bond.targetId｝、`_life_interaction`｛bond.lifeId, bond.status,
    bond.interactionCount↓｝。
- **行为说明**：query()/listByLife 的 total 在 limit/offset 存在时为下推窗口内计数
  （不再全量计数）；旧索引在既有部署上不会自动删除（createIndex 只增不改），首次启动
  会新建上述索引，冗余旧索引可人工 drop。

## 2026-09 增补：基础能力包 0.3.0 → gateway 跟进（错误分类 + custom 供应商）

前置：@elysia-ai/maheshvara 与四协议包升 0.3.0（错误协议层 / 协议即数据引擎
@elysia-ai/protocol-custom），见上文各节。本次全仓排查结论：唯一运行时消费方为
model-gateway（brain 间接、core 仅类型注释），已完成的跟进与遗留非目标如下。

- **已完成**：
  - 错误分类接入：createHttpProviderError/createProviderApiError 按线制
    parseUpstreamError（真实 message + class）；ProviderError.class；
    providerErrorRetryable——class 在场时权威判定（5xx + 配置类 body 降级防重试
    风暴；408/409 保持历史可重试）；诊断 attempt.errorClass、健康快照
    lastErrorClass、observatory GatewayFailureRecord.errorClass + byErrorClass
    聚合、summarizeError 保留 class。
  - custom 供应商类型：providers/custom.ts（协议构造期整体校验、
    renderCustomProtocolRequestUnchecked 渲染、URL/query/鉴权三模式传输准备、
    errorPath 映射优先 + OpenAI 信封通用回退）；Config.protocols 字典 + preset id
    引用；koishi Schema 与 validateModelGatewayConfig 同步（custom 必须可解析
    protocol）。
  - maxTokensField 选项：ProviderConfig/Schema → bridge 写入
    RawExtra.max_tokens_field → protocol-openai 0.3.0 回写 max_completion_tokens
    （o 系模型）。
- **非目标/遗留**：
  - 流式（SSE）接入：gateway 仍为请求/响应单发；协议包的四个流解码器与
    protocol-custom 的 CustomProtocolStreamDecoder 均为 export-only，待流式特性
    立项（需要 Provider.execute 之外的流式通道 + readSSE 管线）。
  - 自定义协议的模型发现端点（renderCustomProtocolModelsRequest /
    parseCustomProtocolModels）未接 koishi 命令——custom provider 的 model 仍需
    手填。
  - brain/dialogue 的用户可见错误文案：链路当前吞错入日志，无文案路径，class
    字段已备好待将来接。
  - ParseUpstreamError 的 OpenAI 分支不按 error.type 分类（Go 忠实语义：OpenAI
    已废弃 type 细分，细分走 code）——OpenAI 线分类完全来自 HTTP 状态码。
