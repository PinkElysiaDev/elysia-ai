# Elysia A.I. Development Roadmap

> **现状校准（2026-06）**：本路线图正文部分章节的"当前仍未完成"已过时——
> 经代码核实，以下能力**实际已完成**，以 `elysia-ai-review-2026-06.md`（第五/六章）为权威现状记录：
> - **3.7 model-gateway**：真实 provider（OpenAI / Gemini / Claude / openai-compatible，HTTP fetch）、
>   retry（指数退避）、circuit-breaker（健康追踪）、fallback（槽位链）**均已实现并测试**。
> - **memory / bond 持久化**：已服务端过滤查询（按 lifeId）取代全表 hydrate，accessCount 用原子 `$inc`；
>   `MongoProjectionRuleRepository` / `MongoScheduledTaskRepository` 已新建；Mongo 经 `mongo.uri` 连接（可选依赖、用户自部署）。
> - **core schema**：memory / behavior / homeostasis / dialogue / persona 的 Zod schema 已补齐导出。
> - **homeostasis**：已具备恢复动力学（朝基线松弛的 idle 恢复，非只衰减），且仅对 `projection.routed` 路由的生命 tick。
>
> 仍属未来（合法未建）：observatory trace 持久化 / dashboard UI / 完整 RBAC、behavior bucket 池、Redis 辅助层。


## 鏂囨。鐢ㄩ€?
鏈枃妗ｇ敤浜庤褰?**Elysia A.I.** 鐨勫綋鍓嶅紑鍙戠姸鎬併€佸凡瀹屾垚浜嬮」銆佸綋鍓嶄富鎴樺満涓庝笅涓€闃舵璁″垝銆?
瀹冧笌鍏朵粬鏂囨。鐨勫垎宸ュ涓嬶細

- `elysia-ai-top-level-design.md`
  - 璁板綍绋冲畾鐨勯《灞傝璁°€佹牳蹇冨垎灞傘€侀暱鏈熸灦鏋勫師鍒?- `elysia-ai-core-contracts.md`
  - 璁板綍 `@elysia-ai/core` 鐨勬寮忕被鍨嬨€佹帴鍙ｃ€佷簨浠朵笌鎶借薄杈圭晫
- `elysia-ai-development-roadmap.md`
  - 璁板綍鈥滅幇鍦ㄥ仛鍒板摢閲屼簡銆佸綋鍓嶆渶閲嶈鐨勯棶棰樻槸浠€涔堛€佹帴涓嬫潵鍏堝仛浠€涔堚€?
**鏈枃浠舵鏂囧彧淇濈暀褰撳墠鏈夋晥鐨勫紑鍙戠姸鎬佷笌璁″垝銆?*
浠嶆湁浠峰€肩殑鍘嗗彶璇曢敊銆侀樁娈典慨姝ｅ拰宸ョ▼缁忛獙锛屼細鍦ㄦ枃鏈互闄勫綍褰㈠紡淇濈暀銆?
---

## 涓€銆侀」鐩綋鍓嶇姸鎬侊紙绠€鐗堬級

鎴嚦褰撳墠锛孍lysia A.I. 宸茬粡涓嶅啀澶勪簬鈥滄蹇佃璁衡€濋樁娈碉紝鑰屾槸杩涘叆锛?
> **涓诲共濂戠害宸茬粡鏀跺彛銆佽緭鍏ヤ富閾惧凡缁忚惤鍦般€佺粨鏋勫垎灞傚凡缁忓畬鎴愩€佹寮忔墽琛岄摼涓庤娴嬮棴鐜鍦ㄦ寜姝ｅ紡鏋舵瀯缁х画鏀跺彛** 鐨勯樁娈点€?
鍙互鐢ㄤ笅闈?4 鍙ヨ瘽姒傛嫭褰撳墠鐘舵€侊細

1. **鏋舵瀯鏂瑰悜宸茬粡绋冲畾**
   - 椤圭洰鏄庣‘鏄€滆櫄鎷熺敓鍛借繍琛屾鏋垛€濓紝涓嶆槸鏅€氳亰澶╂彃浠?   - 澶氬寘鍒嗗眰鏂规宸茬粡纭畾锛屼笉鍐嶅洖閫€涓哄崟澶у寘

2. **宸ョ▼缁撴瀯宸茬粡瀹屾垚涓€杞叧閿敹鍙?*
   - 鍐呴儴鑳藉姏鍖呯粺涓€鏀舵潫鍒?`packages/@elysia-ai/*`
   - Koishi 瀹夸富鍏ュ彛鎻掍欢鍖呯嫭绔嬩负锛?     - `packages/elysia-ai-runtime`
     - `packages/elysia-ai-body`

3. **杈撳叆涓婚摼宸茬粡鎵撻€氬埌 behavior**
   - body 宸茶兘鎶婂閮ㄨ緭鍏ヨ浆鎴愭寮?`Stimulus`
   - runtime 宸茶兘浼犳挱鐪熷疄 `Stimulus`
   - behavior 宸茶兘鍩轰簬鐪熷疄鍒烘縺鍋氱涓€杞?planner 瑙勫垝
   - behavior 宸茶兘鍙戝嚭姝ｅ紡 `behavior.instruction`

4. **涓婚摼鎵ц闂幆宸茬粡褰㈡垚鍙祴璇?MVP**
   - `@elysia-ai/dialogue` 宸叉湁姝ｅ紡 `DefaultDialogueService`
   - `@elysia-ai/brain` 宸叉湁姝ｅ紡 `DefaultBrainService`
   - `@elysia-ai/model-gateway` 宸叉湁姝ｅ紡 `DefaultModelGatewayService`
   - `behavior -> dialogue -> brain -> gateway -> dialogue.output -> body sender` 涓婚摼宸插彲杩愯
   - `dialogue.output.created` 鍒?`body.message.sent / body.message.failed` 鐨勮緭鍑洪棴鐜凡鎵撻€?   - `observatory` 宸叉帴鍏ヤ富閾句簨浠讹紝鏀寔鎸?`stimulusId` 鑱氬悎 trace 涓?recent events
   - runtime routing銆佺姸鎬佸眰銆侀暱鏈熻兘鍔涘眰銆佹寔涔呭寲灞備粛鎸夋寮忔灦鏋勭户缁帹杩?
5. **Memory System v1 宸插舰鎴愰暱鏈熻蹇嗕富骞查棴鐜?*
   - `MemoryEntry / MemoryKind / MemoryScope / MemoryStatus / MemorySource` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `MemoryOwnerType / MemoryVisibility / MemoryRelation / MemoryAttributionMode` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `MemoryUpdateRequest / MemoryUpdateResult / MemoryQuery / MemorySearchResult` 宸茶繘鍏?`core`
   - `MemoryAttributor / MemoryAttributionResult` 宸蹭綔涓鸿蹇嗗綊鍥犱笌璺敱绛栫暐杈圭晫杩涘叆 `core`
   - `MemoryConsolidationRequest / MemoryConsolidationResult` 宸茶繘鍏?`core`
   - `MemoryRepository / MemoryService` 宸蹭綔涓洪暱鏈熻蹇嗕簨瀹炴簮涓庣瓥鐣ヨ竟鐣岃繘鍏?`core`
   - runtime 宸叉彁渚?`MemoryMemoryRepository`
   - runtime 宸叉彁渚?`DefaultMemoryService`
   - runtime 宸叉彁渚?`DeterministicMemoryAttributor`
   - runtime 宸叉寕杞?`memoryRepository` 涓?`memoryService`
   - runtime 鏀寔閫氳繃 `createDefaultRuntime({ memoryAttributor })` 娉ㄥ叆鑷畾涔?memory attribution 绛栫暐
   - behavior execution 鐨?`memory-update` action 浼氬彂鍑?`behavior.memory.update.requested`
   - memory service 浼氭秷璐?`behavior.memory.update.requested`锛屽苟鍐欏叆姝ｅ紡 `MemoryEntry`
   - memory service 褰撳墠鏀寔锛?     - 鍒涘缓 memory
     - 鍚堝苟鍚?source stimulus 鐨勯噸澶嶆洿鏂?     - deterministic attribution锛氭牴鎹?actor / habitat / thread / metadata 灏嗚姹傝矾鐢变负 actor private銆乼hread shared銆乭abitat 鎴?global semantic memory
     - 涓€鏉″師濮?memory update request 閫氳繃 attributor 鐢熸垚澶氭潯姝ｅ紡 memory 鍐欏叆璇锋眰
     - 鎸?life / actor / habitat / thread / stimulus / kind / scope / owner / relation / event / visibility / tag / text / importance 鏌ヨ
     - retrieve 鏃舵洿鏂?`accessCount / lastAccessedAt`
     - 瑙勫垯鐗?consolidation锛岀敓鎴?consolidated memory 骞跺綊妗ｆ棫鏉＄洰
   - memory 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛?     - `memory.created`
     - `memory.updated`
     - `memory.update.failed`
     - `memory.retrieved`
     - `memory.retrieve.failed`
     - `memory.consolidation.requested`
     - `memory.consolidated`
     - `memory.consolidation.failed`
   - observatory 宸叉帴鍏?memory 鍏ㄩ摼璺簨浠讹紝鏀寔 memoryId / memoryRequestId / lifeId / habitatId / scopeType 鎻愬彇
   - Memory Context Injection v1 宸插舰鎴?rule-based 妫€绱晶涓婁笅鏂囨瀯寤洪棴鐜細
     - `MemoryContextRequest / MemoryContextPack / MemoryContextItem / MemoryContextProvider` 宸茶繘鍏?`core`
     - runtime 宸叉彁渚?`RuleBasedMemoryContextProvider`
     - runtime 宸叉寕杞?`memoryContextProvider`
     - dialogue 浼氬湪鏋勯€?`BrainRequest` 鍓嶆寜 life / actor / habitat / thread / content 鏋勫缓 memory context
     - brain 浼氭妸 `BrainRequest.memoryContext` 娉ㄥ叆 system message 鐨勯暱鏈熻蹇嗕笂涓嬫枃 section
     - memory context 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚memory.context.requested / selected / failed`
   - Phase 20 闆嗘垚娴嬭瘯宸茶鐩?memory 鍐欏叆銆佹洿鏂般€佹煡璇€佽闂粺璁°€乧onsolidation銆佸け璐ヨ矾寰勪笌 Phase 18 / 19 鍥炲綊
   - Phase 23 闆嗘垚娴嬭瘯宸茶鐩?memory attribution銆乷wner / relation / event / visibility 鏌ヨ銆佽嚜瀹氫箟 attributor 澶氬啓鍏ヤ笌 Phase 20 鍥炲綊
   - Memory Relevance Selection v1 宸插舰鎴?AI-assisted selector 闂幆锛?     - `MemoryRelevanceSelectionRequest / MemoryRelevanceSelectionResult / MemoryRelevanceSelector` 宸茶繘鍏?`core`
     - `BrainCapability` 宸叉墿灞?`memory-relevance-selection`
     - runtime 宸叉彁渚?`RuleBasedMemoryRelevanceSelector`
     - runtime 宸叉彁渚?`AiAssistedMemoryRelevanceSelector`
     - `RuleBasedMemoryContextProvider` 鏀寔娉ㄥ叆 selector锛屽湪 scored candidates 鍚庢帴绠℃渶缁堜笂涓嬫枃閫夋嫨
     - `createDefaultRuntime({ memoryRelevanceSelector })` 鏀寔娉ㄥ叆 memory relevance selector
     - AI selector 鍙湪鍊欓€夐泦鍚堜腑閫夋嫨 memory锛屼笉鐩存帴鏌ヨ repository
     - AI selector 鏀寔 JSON 瑙ｆ瀽銆乻electedIds 閲嶆帓銆乺easonById 瑙ｉ噴涓庡け璐?fallback
     - memory relevance selection 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚memory.relevance.selection.requested / completed / failed / fallback`
   - Phase 24 闆嗘垚娴嬭瘯宸茶鐩?rule-based memory context provider銆乨ialogue -> brain context 娉ㄥ叆銆乥rain -> gateway system prompt 娉ㄥ叆涓?Phase 20 / 23 鍥炲綊
   - Phase 25 闆嗘垚娴嬭瘯宸茶鐩?rule-based selector銆丄I-assisted selector 鎴愬姛璺緞銆丄I 澶辫触 fallback銆乧ontext provider selector 娉ㄥ叆銆乺untime selector 娉ㄥ叆涓?Phase 20 / 23 / 24 鍥炲綊

6. **Bond System v1 宸插舰鎴愰暱鏈熷叧绯讳富骞查棴鐜?*
   - `Bond / BondMetrics / BondTargetType / BondStatus / BondSource` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `BondUpdateRequest / BondUpdateResult / BondQuery / BondSearchResult` 宸茶繘鍏?`core`
   - `BondRepository / BondService` 宸蹭綔涓洪暱鏈熷叧绯讳簨瀹炴簮涓庣瓥鐣ヨ竟鐣岃繘鍏?`core`
   - runtime 宸叉彁渚?`MemoryBondRepository`
   - runtime 宸叉彁渚?`DefaultBondService`
   - runtime 宸叉寕杞?`bondRepository` 涓?`bondService`
   - behavior execution 鐨?`bond-update` action 浼氬彂鍑?`behavior.bond.update.requested`
   - bond service 浼氭秷璐?`behavior.bond.update.requested`锛屽苟鍐欏叆姝ｅ紡 `Bond`
   - bond service 褰撳墠鏀寔锛?     - 鍒涘缓 bond
     - 鎸?`lifeId + targetId + targetType` 鍚堝苟閲嶅鏇存柊
     - 绱 familiarity / intimacy / trust / tension / dependence metrics
     - 鎸?life / target / targetType / status / tag / metric threshold 鏌ヨ
     - retrieve 鏃跺彂鍑烘寮忔煡璇簨浠?   - bond 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛?     - `bond.created`
     - `bond.updated`
     - `bond.update.failed`
     - `bond.retrieved`
     - `bond.retrieve.failed`
   - observatory 宸叉帴鍏?bond 鍏ㄩ摼璺簨浠讹紝鏀寔 bondId / bondRequestId / bondTargetId / bondTargetType / lifeId 鎻愬彇
   - Bond Context Injection v1 宸插舰鎴?rule-based 妫€绱晶涓婁笅鏂囨瀯寤洪棴鐜細
     - `BondContextRequest / BondContextPack / BondContextItem / BondContextProvider` 宸茶繘鍏?`core`
     - runtime 宸叉彁渚?`RuleBasedBondContextProvider`
     - runtime 宸叉寕杞?`bondContextProvider`
     - dialogue 浼氬湪鏋勯€?`BrainRequest` 鍓嶆寜 life / actor / habitat / thread / content 鏋勫缓 bond context
     - brain 浼氭妸 `BrainRequest.bondContext` 娉ㄥ叆 system message 鐨勫叧绯讳笂涓嬫枃 section
     - bond context 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚bond.context.requested / selected / failed`
   - Bond Relevance Selection v1 宸插舰鎴?AI-assisted selector 闂幆锛?     - `BondRelevanceSelectionRequest / BondRelevanceSelectionResult / BondRelevanceSelector` 宸茶繘鍏?`core`
     - `BrainCapability` 宸叉墿灞?`bond-relevance-selection`
     - runtime 宸叉彁渚?`RuleBasedBondRelevanceSelector`
     - runtime 宸叉彁渚?`AiAssistedBondRelevanceSelector`
     - `RuleBasedBondContextProvider` 鏀寔娉ㄥ叆 selector锛屽湪 scored candidates 鍚庢帴绠℃渶缁堜笂涓嬫枃閫夋嫨
     - `createDefaultRuntime({ bondRelevanceSelector })` 鏀寔娉ㄥ叆 bond relevance selector
     - AI selector 鍙湪鍊欓€夐泦鍚堜腑閫夋嫨 bond锛屼笉鐩存帴鏌ヨ repository
     - AI selector 鏀寔 JSON 瑙ｆ瀽銆乻electedIds 閲嶆帓銆乺easonById 瑙ｉ噴涓庡け璐?fallback
     - bond relevance selection 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚bond.relevance.selection.requested / completed / failed / fallback`
   - Brain Context Budget Governance v1 宸插舰鎴?prompt 鎴柇娌荤悊锛?     - brain config 鏀寔 `contextBudget.maxMemoryChars / maxBondChars / maxSystemPromptChars`
     - prompt 缁勫悎椤哄簭宸叉寮忔敹鍙ｄ负锛歳equest override -> persona -> config fallback -> memory context -> bond context -> budget truncation
     - persona 瀛樺湪鏃舵浛浠?config fallback锛沵emory context 涓?bond context 浼氬垎鍒寜棰勭畻鎴柇鍚庡啀浣滀负闄勫姞 section 鍚堝苟杩?system message
     - bond context 鍙奖鍝嶈姘斻€佽竟鐣屻€佺啛鎮夊害涓庤皑鎱庡害锛屼笉瑕嗙洊 persona锛屼篃涓嶅悜鐢ㄦ埛娉勯湶鍐呴儴 score / reason
     - 鏈€缁?system prompt 浼氭寜鎬婚绠椾簩娆℃埅鏂?     - gateway metadata 浼氳褰?memory / bond / system prompt 鏄惁鍙戠敓鎴柇涓庢渶缁堥暱搴?   - Phase 21 闆嗘垚娴嬭瘯宸茶鐩?bond 鍐欏叆銆佹洿鏂般€佹煡璇€佸け璐ヨ矾寰勩€乷bservatory 璁板綍涓?Phase 18 / 19 / 20 鍥炲綊
   - Phase 26 闆嗘垚娴嬭瘯宸茶鐩?rule-based bond context provider銆乨ialogue -> brain context 娉ㄥ叆銆乥rain -> gateway system prompt 娉ㄥ叆涓?Phase 21 鍥炲綊
   - Phase 27 闆嗘垚娴嬭瘯宸茶鐩?rule-based selector銆丄I-assisted selector 鎴愬姛璺緞銆丄I 澶辫触 fallback銆乧ontext provider selector 娉ㄥ叆銆乺untime selector 娉ㄥ叆銆乥rain context budget 娌荤悊涓?Phase 21 / 24 / 25 / 26 鍥炲綊

7. **Behavior Execution Layer 宸插舰鎴愮涓€杞寮忔墽琛岀紪鎺?*
   - `BehaviorExecutionPlan` / `BehaviorExecutionAction` / `BehaviorExecutionResult` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - behavior 宸叉彁渚?`createBehaviorExecutionPlan()`锛屽彲灏?`ResponsePlan` flags 灞曞紑涓烘寮忔墽琛?actions
   - runtime 宸叉彁渚?`DefaultBehaviorExecutionService`
   - execution service 褰撳墠缁熶竴鎵挎帴锛?     - `dialogue`
     - `schedule-followup`
     - `memory-update`
     - `bond-update`
     - `homeostasis-update`
     - `emit-event`
     - `noop`
   - follow-up 璋冨害閫氳繃 scheduler 鍒涘缓 `ScheduledTask`
   - memory / bond / homeostasis 鍚庡鐞嗗綋鍓嶉€氳繃 request event 杈撳嚭锛屼笉鍦?execution 灞傚彂鏄庡叿浣撻暱鏈熺畻娉?   - runtime 宸叉寕杞?`behaviorExecution`
   - runtime start / stop 宸叉帴鍏?scheduler loop 鐢熷懡鍛ㄦ湡
   - execution layer 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛?     - `behavior.execution.started`
     - `behavior.execution.action.started`
     - `behavior.execution.action.completed`
     - `behavior.execution.action.failed`
     - `behavior.execution.completed`
     - `behavior.execution.failed`
     - `behavior.followup.scheduled`
     - `behavior.memory.update.requested`
     - `behavior.bond.update.requested`
     - `behavior.homeostasis.update.requested`
   - observatory 宸叉帴鍏?execution layer 涓?side-effect request 浜嬩欢
   - Phase 19 闆嗘垚娴嬭瘯宸茶鐩?plan 灞曞紑銆乪xecution service 鎵ц閾俱€乫ollow-up 璋冨害涓?scheduler retry

8. **Scheduler 鏈€灏忛棴鐜凡杩涘叆 runtime**
   - `ScheduledTask` 宸茶繘鍏?`core` 姝ｅ紡绫诲瀷灞?   - `ScheduledTaskRepository` 宸茶繘鍏?`core` repository 鎶借薄灞?   - runtime 宸叉彁渚?`MemoryScheduledTaskRepository`
   - runtime 宸叉彁渚?`DefaultSchedulerService`
   - runtime 宸叉寕杞?`scheduledTaskRepository` 涓?`scheduler`
   - scheduler 褰撳墠鏀寔鏈€灏忚兘鍔涳細schedule / cancel / tick / runTask / listTasks
   - due task 鎸?`priority` 浠庨珮鍒颁綆鎵ц
   - completed / cancelled task 涓嶄細閲嶅鎵ц
   - failed task 浼氳褰?attempts / lastError
   - expired task 浼氭爣璁颁负 expired
   - follow-up task 鍙€氳繃 `payload.stimulus` 閲嶆柊娉ㄥ叆 `stimulus.received`
   - scheduler 浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚scheduler.task.created / started / completed / failed / cancelled / expired`

9. **Projection / Life Routing 宸叉寮忔帴鍏ヤ富閾惧苟鏀寔瑙勫垯璺敱**
   - `ProjectionResolver` 鎺ュ彛宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `ProjectionRule` 宸茶繘鍏?`core` 姝ｅ紡绫诲瀷灞?   - `ProjectionRuleRepository` 宸茶繘鍏?`core` repository 鎶借薄灞?   - runtime 宸叉彁渚?`MemoryProjectionRegistry`
   - runtime 宸叉彁渚?`MemoryProjectionRuleRepository`
   - runtime 宸叉彁渚?`ProjectionRuleService`锛屾敮鎸?projection rules 浠?repository 鍔犺浇銆乽psert銆乨isable銆乺emove 涓庝簨浠堕€氱煡
   - `DefaultProjectionResolver` 宸叉敮鎸佸熀浜庤鍒欑殑 life routing
   - 鏃?projection rules 鏃朵繚鐣欐棫琛屼负锛氭墍鏈?active life 鍧囨劅鐭?   - 瀛樺湪 projection rules 鏃朵粎鍛戒腑瑙勫垯鐨?active life 鎰熺煡
   - projection rules 鏀寔 `habitatId / channelId / threadId / actorId / platform / botId` 鍖归厤
   - 鍛戒腑瑙勫垯鎸?`priority` 浠庨珮鍒颁綆鎺掑簭
   - manifest `extensions.projection.rules` 鍙嚜鍔ㄥ啓鍏?repository 骞舵敞鍐?projection rules
   - `receiveStimulus()` 鐜板湪鍙戝嚭 `stimulus.received` 鍚庣揣鎺?`projection.routed`
   - behavior 灞傚凡浠庣洃鍚?`stimulus.received` 鏀逛负鐩戝惉 `projection.routed`
   - 澶?life 鍦烘櫙涓嬫瘡涓?routed life 鐙珛鏀跺埌 `behavior.instruction`
   - 鏃犲尮閰?life 鏃朵笉瑙﹀彂 behavior planning
   - 鑷畾涔?`ProjectionResolver` 鍙€氳繃 runtime 娉ㄥ叆
   - projection rule 鐑洿鏂颁細绔嬪嵆褰卞搷鍚庣画 routing
   - projection rule 鍙樻洿浜嬩欢宸茶繘鍏ヤ簨浠舵€荤嚎锛歚projection.rule.updated / projection.rule.disabled / projection.rule.removed`

10. **Persona 宸叉寮忔帴鍏ヤ富閾?*
   - `Persona` / `PersonaRegistry` 鎺ュ彛宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `MemoryPersonaRegistry` 宸插湪 runtime 涓疄鐜?   - manifest `extensions.persona` 鑷姩瑙ｆ瀽骞舵敞鍐屽埌 `personaRegistry`
   - brain 灞傛寜 `request.lifeId` 鏌ユ壘 persona锛屾敞鍏?`systemPrompt`
   - 浼樺厛绾э細`request.systemPrompt > persona.systemPrompt > config.systemPrompt`
   - dialogue 灞備粠 `instruction.lifeId` 浼犻€?`task.lifeId` 鍒?brain
   - 澶?life 涓嶅悓 persona 鍚勮嚜浣跨敤鐙珛 system prompt

11. **鐢熷懡鐘舵€佸眰宸插畬鎴愮涓€杞富閾炬帴鍏ワ紝骞舵帴鍏ヨ繍琛屾椂鐘舵€佷粨鍌?*
   - `PerceptionResult` / `HomeostasisState` / `HomeostasisDelta` / `CognitionResult` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - `LifeStateRepository` 宸蹭綔涓虹敓鍛界姸鎬佷簨瀹炴簮鎶借薄杩涘叆 `core`
   - runtime 宸叉彁渚?`MemoryStateRepository<HomeostasisState>`
   - runtime 宸叉彁渚?Mongo-compatible `MongoStateRepository<HomeostasisState>` 璧锋瀹炵幇锛岀敤浜庢壙鎺?MongoDB 浜嬪疄婧愯惤鍦?   - runtime 鎻掍欢宸叉敮鎸侀€氳繃 `stateRepository.type` 鍦?`memory / mongo` 涔嬮棿閫夋嫨鐢熷懡鐘舵€佷粨鍌?   - Mongo 妯″紡宸插叿澶囪繛鎺ョ敓鍛藉懆鏈熴€乧ollection 閫夋嫨銆佺储寮曞垵濮嬪寲銆乨ispose 鍏抽棴涓庡け璐?fallback / fail-fast 绛栫暐
   - homeostasis 宸查€氳繃 runtime `stateRepository` 鍒濆鍖栥€佹仮澶嶅苟鍐欏洖 `HomeostasisState`
   - `perception.completed` 宸叉惡甯﹀畬鏁存劅鐭ョ粨鏋滐紙intent / entities / sentiment / tokenCount锛?   - `homeostasis.updated` 宸叉惡甯?state / delta锛屽彲琚?behavior 鎸?lifeId 缂撳瓨
   - `behavior.homeostasis.update.requested` 宸蹭綔涓烘墽琛屽眰姝ｅ紡璇锋眰浜嬩欢杩涘叆浜嬩欢鎬荤嚎
   - `homeostasis.update.failed` 宸蹭綔涓哄け璐ヤ簨浠惰繘鍏ヤ簨浠舵€荤嚎骞惰 observatory 鏃佽矾璁板綍
   - runtime 宸叉寕杞?`homeostasisService`
   - cognition 宸蹭粠鐩戝惉 `stimulus.received` 璋冩暣涓哄熀浜?`projection.routed` 鎸?routed life 鐙珛鎺ㄧ悊
   - behavior 宸叉秷璐?perception / cognition / homeostasis 涓婁笅鏂?   - `cognition.shouldEnterBehavior === false` 鏃跺彲闃绘瀵瑰簲 life 杩涘叆 `behavior.instruction`
   - observatory 宸茬撼鍏?`cognition.reasoning / cognition.completed` 涓婚摼瑙傛祴浜嬩欢

12. **Homeostasis Request Consumer v1 宸插舰鎴愬彲娴嬭瘯闂幆**
   - `HomeostasisService` 宸茶繘鍏?`core` 姝ｅ紡濂戠害灞?   - runtime 宸叉彁渚?`DefaultHomeostasisService`
   - `DefaultHomeostasisService` 浼氭秷璐?`behavior.homeostasis.update.requested`
   - `HomeostasisUpdateRequest / HomeostasisUpdateResult` 宸茶繘鍏?`core`
   - `homeostasis.updated / homeostasis.update.failed` 宸茶繘鍏ヤ簨浠舵€荤嚎涓?observatory trace
   - Phase 22 闆嗘垚娴嬭瘯宸茶鐩?homeostasis 鍐欏叆銆佸悎骞躲€乧lamp 涓庡け璐ヨ矾寰?
13. **Persona 宸叉寮忚繘鍏?behavior / brain 鍐崇瓥閾?*
   - persona traits 宸插奖鍝?behavior signal锛堟俯鏌?濂藉/娲绘臣/娌夌ǔ鍚勬湁鐙珛淇瑙勫垯锛?   - persona traits + tone 宸叉敞鍏?brain system prompt锛堜笉鍐嶅彧娉ㄥ叆 systemPrompt 瀛楃涓诧級
   - `applyPersonaToSignal()` 宸叉娊绂讳负鐙珛妯″潡 `behavior/src/persona-signal.ts`
   - brain 灞?`buildPersonaSystemPrompt()` 缁勫悎 systemPrompt + traits + tone
   - gateway metadata 鎼哄甫 personaName / personaTraits / personaTone

14. **Perception / Cognition AI Enhanced 鍙€夎矾寰勫凡灏变綅**
   - perception 鏀寔 `aiEnhanced` 閰嶇疆锛岄粯璁ゅ叧闂?   - perception AI enhanced 閫氳繃 brain `perception-analysis` capability 璋冪敤 LLM
   - AI 缁撴灉鎸?confidence 涓庤鍒欑粨鏋滃悎骞讹紙intent / entities / sentiment锛?   - AI 澶辫触鏃?fallback 鍒?rule-based 缁撴灉
   - cognition 宸叉秷璐?perception 缁撴灉锛坕ntent / sentiment 褰卞搷 salience锛?   - cognition 宸叉秷璐?homeostasis 鐘舵€侊紙sociability / energy / curiosity / mood 褰卞搷 salience锛?   - cognition 宸叉秷璐?persona traits锛堟俯鏌?濂藉/娲绘臣/娌夌ǔ寰皟 salience锛?   - cognition reason 宸叉敼涓哄姩鎬佸彲瑙ｉ噴瀛楃涓?   - cognition 鏀寔 `aiEnhanced` 閰嶇疆锛岄粯璁ゅ叧闂?   - cognition AI enhanced 閫氳繃 brain `cognition-reasoning` capability 璋冪敤 LLM
   - AI 缁撴灉鎸?rule:0.6 / ai:0.4 鍔犳潈鍚堝苟 salience / continuity
   - `shouldEnterBehavior` 鍙栬鍒欑増 OR (AI 鐗?AND 鍚堝苟鍒嗚秴杩囬槇鍊?
   - perception / cognition 鐨?metadata 鍧囨惡甯?mode / aiRequested / aiSucceeded / provider / usage / errorSummary
   - observatory 鑷姩閲囬泦杩欎簺 metadata锛屾棤闇€棰濆鏀瑰姩
   - `BrainCapability` 宸叉墿灞曪細`perception-analysis` / `cognition-reasoning`
   - `PerceptionResult` 宸插鍔?`metadata` 瀛楁
   - `CognitionContext` 宸插鍔?`perception` / `homeostasis` 瀛楁

---

## 浜屻€佸綋鍓嶆湁鏁堢殑缁撴瀯缁撹

## 2.1 椤圭洰瀹氫綅
Elysia A.I. 鐨勬牳蹇冧笉鏄璇濈晫闈紝鑰屾槸锛?
> **涓€涓互鍒烘縺銆佺姸鎬併€佽涓哄拰琛ㄨ揪涓轰富绾跨殑铏氭嫙鐢熷懡杩愯妗嗘灦銆?*

---

## 2.2 褰撳墠宸ョ▼鍒嗗眰
褰撳墠宸ョ▼缁撴瀯宸茬粡鏄庣‘鍖哄垎涓ょ被鍖咃細

### A. 鍐呴儴鑳藉姏 / 鍗忚鍖?浣嶄簬锛?
```txt
packages/@elysia-ai/*
```

鍖呮嫭锛?- `@elysia-ai/core`
- `@elysia-ai/behavior`
- `@elysia-ai/brain`
- `@elysia-ai/dialogue`
- `@elysia-ai/cognition`
- `@elysia-ai/homeostasis`
- `@elysia-ai/model-gateway`
- `@elysia-ai/observatory`
- `@elysia-ai/perception`
- `@elysia-ai/persona`
- `@elysia-ai/shared`

### B. Koishi 瀹夸富鍏ュ彛鎻掍欢鍖?浣嶄簬锛?
```txt
packages/elysia-ai-runtime
packages/elysia-ai-body
```

瀵瑰鍙戝竷鍚嶄负锛?- `koishi-plugin-elysia-ai-runtime`
- `koishi-plugin-elysia-ai-body`

---

## 2.3 褰撳墠閫昏緫涓诲寘鍒嗗眰
浠庨€昏緫鑱岃矗涓婏紝褰撳墠闀挎湡淇濈暀鐨勪富鍖呬粛鐒跺寘鎷細

- `core`
- `runtime`
- `body`
- `perception`
- `homeostasis`
- `cognition`
- `persona`
- `behavior`
- `dialogue`
- `brain`
- `model-gateway`
- `observatory`
- `shared`

浣嗕粠宸ョ▼缁撴瀯涓婏紝瀹冧滑涓嶅啀骞抽摵娣锋斁锛岃€屾槸宸茬粡鎸夛細
- 鍐呴儴鑳藉姏鍖?- 瀹夸富鍏ュ彛鎻掍欢鍖?
瀹屾垚鍒嗗眰銆?
---

## 2.4 `brain` 涓?`model-gateway` 蹇呴』鍒嗙
- `brain` 璐熻矗鈥滄垜瑕侀棶浠€涔堚€?- `model-gateway` 璐熻矗鈥滆繖涓姹傚埌搴曟€庝箞鍙戠粰鍝釜妯″瀷鈥?
杩欐潯杈圭晫浠嶇劧鏈夋晥锛屼笉搴斿悎骞躲€?
---

## 2.5 `dialogue` 浠嶄繚鐣欓《绾ч€昏緫涓诲寘鍦颁綅
铏界劧琛ㄨ揪閫昏緫涓婂睘浜庤涓虹殑涓€閮ㄥ垎锛屼絾宸ョ▼涓婂綋鍓嶄粛淇濈暀涓虹嫭绔嬮€昏緫涓诲寘锛屼究浜庡舰鎴愮ǔ瀹氱殑鎵ц杈圭晫銆?褰撳墠鐪熷疄宸ョ▼浣嶇疆涓猴細

```txt
packages/@elysia-ai/dialogue
```

---

## 涓夈€佸綋鍓嶄唬鐮佽繘搴︼紙鎸夊綋鍓嶆柊缁撴瀯锛?
## 3.1 `packages/@elysia-ai/core`
### 褰撳墠宸插畬鎴?- 绗竴鎵规牳蹇冨璞＄被鍨嬶細
  - `LifeInstance`
  - `Habitat`
  - `Bond`
  - `Thread`
  - `Stimulus`
- 瀵瑰簲 schema 宸插紑濮嬭惤鍦?- Event Bus 鎶借薄涓庨粯璁?`MemoryEventBus`
- 绗竴鎵?repository 鎶借薄锛?  - `LifeRepository`
  - `StateRepository`
  - `TraceRepository`
  - `StimulusRepository`
  - `BondRepository`
  - `ProjectionRuleRepository`
  - `ScheduledTaskRepository`
- 姝ｅ紡鍖栫殑 dialogue / brain / gateway 濂戠害锛?  - `DialogueTask`
  - `DialogueResult`
  - `DialogueService`
  - `BrainRequest`
  - `BrainResponse`
  - `BrainCapability`
  - `BrainService`
  - `ModelGatewayRequest`
  - `ModelGatewayResponse`
  - `ProviderDescriptor`
  - `RoutingResult`
  - `ModelUsage`
  - `ModelGatewayService`
  - `BrainCapability` 宸茶ˉ鍏?`memory-relevance-selection` 涓?`bond-relevance-selection`
- `CoreEventMap` 宸茶ˉ鍏ヤ富閾句簨浠讹細
  - runtime 鐢熷懡鍛ㄦ湡浜嬩欢
  - `stimulus.received`
  - `projection.routed`
  - `scheduler.task.*`
  - `perception.completed`
  - `homeostasis.updated`
  - `cognition.reasoning`
  - `cognition.completed`
  - `behavior.selected`
  - `behavior.instruction`
  - `behavior.execution.*`
  - `behavior.followup.scheduled`
  - `behavior.memory.update.requested`
  - `behavior.bond.update.requested`
  - `behavior.homeostasis.update.requested`
  - `dialogue.task.created`
  - `dialogue.generation.requested`
  - `dialogue.output.created`
  - `dialogue.*`
  - `brain.*`
  - `gateway.*`
  - `sender.*`
  - `body.message.*`
  - `memory.*`
  - `bond.*`
  - `memory.context.*`
  - `memory.relevance.selection.*`
  - `bond.context.*`
  - `bond.relevance.selection.*`

### 褰撳墠鍒ゆ柇
`@elysia-ai/core` 宸茬粡涓嶅啀鍙槸鈥滃熀纭€瀵硅薄 + 鏃╂湡鎺ュ彛鈥濓紝鑰屾槸锛?
> **寮€濮嬪舰鎴愬彲鏀拺 dialogue / brain / model-gateway 姝ｅ紡鍒嗗眰寮€鍙戠殑涓婚摼濂戠害鍩虹嚎銆?*

### 褰撳墠浠嶆湭瀹屾垚
- `Projection`銆乣BehaviorCandidate` 绛夊璞′粛鏈畬鍏ㄥ畾鍨?- 閮ㄥ垎 schema 浠嶉渶涓庢渶鏂版寮忓璞＄户缁榻?- repository 鐩墠浠嶅彧鏈夋娊璞★紝娌℃湁榛樿瀹炵幇
- 浠嶉渶缁х画鍘嬬缉涓庢竻鐞嗗巻鍙查仐鐣欑殑鏃у绾︾棔杩?
---

## 3.2 `packages/elysia-ai-runtime`
### 褰撳墠宸插畬鎴?- `RuntimeContext`
- `LifeRegistry`
- `HabitatRegistry`
- `DefaultRuntime`
- `createDefaultRuntime()`
- 鏈€灏忕敓鍛藉懆鏈熶富娴佺▼锛?  - `start()`
  - `stop()`
  - `getState()`
  - `isRunning()`
- manifest 鍔犺浇鍏ュ彛
- manifest `extensions.persona` 鍔犺浇
- manifest `extensions.projection.rules` 鍔犺浇
- `MemoryProjectionRegistry`
- 鍩轰簬 `ProjectionRule` 鐨勯粯璁?life routing
- 鎺ユ敹骞朵紶鎾湡瀹?`Stimulus`
- 鍙戝嚭 `stimulus.received`
- 鍙戝嚭 `projection.routed`
- 鍙戝嚭 runtime 鐢熷懡鍛ㄦ湡浜嬩欢
- 鎸傝浇 `DefaultSchedulerService`
- 鎸傝浇 `DefaultBehaviorExecutionService`
- 鎸傝浇 `DefaultMemoryService`
- 鎸傝浇 `DefaultBondService`
- 鎸傝浇 `RuleBasedBondContextProvider`
- 鏀寔娉ㄥ叆 `memoryRelevanceSelector`
- 鏀寔娉ㄥ叆 `bondRelevanceSelector`
- runtime start / stop 鎺ュ叆 scheduler loop 鐢熷懡鍛ㄦ湡
- 绗竴鎵?runtime 鏃ュ織

### 褰撳墠鍒ゆ柇
`elysia-ai-runtime` 宸茬粡鍏峰锛?
> **鏈€灏忚繍琛屾椂涓诲共**

浣嗚繕娌℃湁杩涘叆鈥滃畬鏁磋繍琛屾椂鑳藉姏灞傗€濋樁娈点€?
### 褰撳墠浠嶆湭瀹屾垚
- Projection rules 鐨?MongoDB 闀挎湡浜嬪疄婧愬疄鐜?- Projection rules 鐨?UI / 绠＄悊 API / 鏉冮檺娌荤悊
- Scheduler 鐨?MongoDB 闀挎湡浜嬪疄婧愩€乧ron銆佸垎甯冨紡 lease 涓庢洿瀹屾暣涓诲姩琛屼负绛栫暐
- manifest 娣卞寲娌荤悊
- 鏇村畬鏁寸殑杩愯鏈熺姸鎬佺鐞?- behavior execution policy / failure policy 鐨勭敓浜х骇娌荤悊
- 瀹夸富浜や粯灞傛渶缁堟敹鍙?
---

## 3.3 `packages/elysia-ai-body`
### 褰撳墠宸插畬鎴?- `PlatformMessage`
- `sessionToPlatformMessage()`
- `PlatformMessage -> Stimulus` 鐨勭涓€杞寮忚浆鎹?- `handlePlatformMessage(runtime, message)`
- `KoishiBodyAdapter`
- body 鎻掍欢鍏ュ彛 `apply()`
- body 杈撳叆閾炬棩蹇?- `dialogue.output.created` 杈撳嚭浜嬩欢鐩戝惉
- route-based sender 杈撳嚭鎶曢€?- `sender.started / sender.completed / sender.failed`
- `body.message.sent / body.message.failed`

### 褰撳墠鍒ゆ柇
`elysia-ai-body` 宸茬粡涓嶅啀鏄┖澹筹紝鑰屾槸锛?
> **寮€濮嬫壙鎷?Koishi 瀹夸富杈撳叆鎺ュ叆涓?Stimulus 鏍囧噯鍖栨ˉ鎺ヨ亴璐ｃ€?*

### 褰撳墠浠嶆湭瀹屾垚
- `StimulusBuilder / StimulusNormalizer` 杩涗竴姝ユ敹鏉?- sender 澶氬钩鍙扮瓥鐣ョ粏鍖?- 澶?Bot / 澶氬钩鍙拌緭鍏ユ不鐞嗙粏鍖?- 鏇村畬鏁寸殑杈撳嚭鎶曢€掔瓥鐣ワ紙buffered / retry / moderation锛?
---

## 3.4 `packages/@elysia-ai/behavior`
### 褰撳墠宸插畬鎴?- 姝ｅ紡绫诲瀷锛?  - `StimulusScope`
  - `StimulusBucket`
  - `StimulusSignal`
  - `ProgramRoutingDecision`
  - `ResponsePlan`
  - `BehaviorPlanningContext`
- 绗竴杞疄鐜帮細
  - `resolveStimulusScope()`
  - signal 璁＄畻
  - program routing
  - `ResponsePlan` 鐢熸垚
- behavior 鎻掍欢鍏ュ彛宸叉帴鍏ワ細
  - 鐩戝惉 `projection.routed`锛圥hase 6 浠?`stimulus.received` 杩佺Щ锛?  - 璁＄畻 `scope / signal / decision`
  - 鐢熸垚 `BehaviorCandidate[]`
  - 閫夋嫨 `BehaviorDecision`
  - 浠庨€変腑 candidate 鏋勯€?`ResponsePlan`
  - 鍙戝嚭 `behavior.candidates.generated`
  - 鍙戝嚭鍏煎鏃ф秷璐规柟鐨?`behavior.selected`
  - 鏋勯€?`BehaviorExecutionInstruction`
  - 鍙戝嚭 `behavior.instruction`

### 褰撳墠鍒ゆ柇
`@elysia-ai/behavior` 宸茬粡褰㈡垚锛?
> **鐪熷疄 stimulus -> candidate generation -> candidate selection -> planner payload 鐨勭涓€杞寮忎富骞?*

褰撳墠 behavior 宸蹭粠鍗曚竴璺敱缁撴灉鐩存帴鐢熸垚 plan锛屾紨杩涗负 candidate generation + selection 涓婚摼銆?`behavior.selected` 浠嶄繚鎸佸吋瀹癸紝鍚屾椂鏂板 `behavior.candidates.generated` 渚?observatory 涓庡悗缁?planner 娣卞寲浣跨敤銆?
### 褰撳墠浠嶆湭瀹屾垚
- 鐪熷疄 bucket / buffer 姹?- AI enhanced interpretation
- `BehaviorExecutionPlan -> memory / scheduler / bond / homeostasis` 鐨勯暱鏈熶簨瀹炴簮娑堣垂鏂规寔缁繁鍖?- 鍊欓€夎涓烘墽琛岀紪鎺掓繁鍖?
---

## 3.5 `packages/@elysia-ai/dialogue`
### 褰撳墠宸插畬鎴?- `core` 灞傜殑 `DialogueTask / DialogueResult / DialogueService` 濂戠害
- `ResponsePlan -> DialogueTask` 杞崲灞傦紙`task-builder.ts`锛?- `DefaultDialogueService` 姝ｅ紡瀹炵幇锛岃皟鐢?`BrainService`
- 鐩戝惉 `behavior.selected`锛屽彂鍑?`dialogue.started / generated / completed / failed`
- 涓诲洖澶嶉摼璺腑锛屽悓涓€ `behavior.instruction` 鍙繘鍏ヤ竴娆?`dialogue.generation.requested`锛汢ehavior Execution Layer 鍙澶栧彂鍑哄甫 `metadata.behaviorExecution === true` 鐨?`dialogue.task.created` 浣滀负鎵ц渚ц娴嬩簨浠?- 鏈湴绫诲瀷灞傦紙`types.ts`锛夎В鍐宠法鍖呬緷璧?
### 褰撳墠鍒ゆ柇
`@elysia-ai/dialogue` 宸茬粡褰㈡垚锛?
> **姝ｅ紡瀵硅瘽鎵ц閾撅紝浠?behavior.selected 鍒?dialogue.completed 鐨勪富閾惧凡鍙繍琛屻€?*

### 褰撳墠浠嶆湭瀹屾垚
- 鏇村鏉傜殑 dialogue 妯″紡锛坉efer / silent-update 鐨勭湡瀹炶涓猴級
- 涓?sender 鐨勬寮忚緭鍑鸿繛鎺?- dialogue 灞?context enrichment锛坧ersona / memory 娉ㄥ叆锛夌户缁繁鍖?- memory / bond 妫€绱晶 AI-assisted LLM 鐩稿叧鎬ч€夋嫨鐨勭敓浜х骇娌荤悊锛堣秴鏃躲€乼oken budget銆佹ā鍨嬭矾鐢便€乸rompt 绛栫暐锛?
---

## 3.6 `packages/@elysia-ai/brain`
### 褰撳墠宸插畬鎴?- 姝ｅ紡璇锋眰/鍝嶅簲/鑳藉姏鎶借薄宸茬粡杩涘叆 `core`
- `DefaultBrainService` 姝ｅ紡瀹炵幇
- 璋冪敤 `DefaultModelGatewayService`
- 鎶?`BrainRequest` 杞垚 `ModelGatewayRequest`
- 鎶?`ModelGatewayResponse` 杞洖 `BrainResponse`

### 褰撳墠鍒ゆ柇
`@elysia-ai/brain` 宸茬粡褰㈡垚锛?
> **鏈€灏忔寮忚鐭ヨ姹傚眰锛宒ialogue -> brain -> gateway 鐨勮皟鐢ㄩ摼宸插彲杩愯銆?*

### 褰撳墠浠嶆湭瀹屾垚
- capability 椹卞姩閫昏緫锛堜笉鍚?capability 璧颁笉鍚岀瓥鐣ワ級
- 澶?brain 瀹炰緥绠＄悊
- capability 椹卞姩鐨?prompt 妯℃澘娌荤悊
- context budget 浠庡瓧绗︾骇娌荤悊婕旇繘鍒?token 绾ф不鐞?
---

## 3.7 `packages/@elysia-ai/model-gateway`
### 褰撳墠宸插畬鎴?- 姝ｅ紡璇锋眰/鍝嶅簲/provider/routing 鎶借薄宸茬粡杩涘叆 `core`
- `DefaultModelGatewayService` 姝ｅ紡瀹炵幇
- `resolveRoute()` 璺敱閫昏緫
- 榛樿 provider锛坄custom` 绫诲瀷鍗犱綅锛?- 杩斿洖鏍囧噯鍖?`ModelGatewayResponse`锛堝惈 usage / finishReason锛?
### 褰撳墠鍒ゆ柇
`@elysia-ai/model-gateway` 宸茬粡褰㈡垚锛?
> **鏈€灏忔寮忔ā鍨嬪嚭鍙ｅ眰锛宐rain -> gateway 鐨勮皟鐢ㄩ摼宸插彲杩愯銆?*

### 褰撳墠浠嶆湭瀹屾垚
- 鐪熷疄 provider 鎺ュ叆锛圤penAI / Gemini / Claude锛?- provider registry 鐪熸鍙姩鎬佹敞鍐?- routing 瑙勫垯鍙厤缃寲
- retry / fallback / downgrade 鏈哄埗

---

## 3.8 `packages/@elysia-ai/observatory`
### 褰撳墠宸插畬鎴?- `ObservedEventRecord`
- `StimulusTrace`
- `ObservatorySnapshot`
- `ObservatoryStore`
- `DefaultObservatoryService`
- recent events 鏌ヨ
- 鎸?`stimulusId` 鏌ヨ瀹屾暣 trace
- 涓婚摼浜嬩欢鏃佽矾閲囬泦锛?  - runtime / life / stimulus
  - behavior
  - dialogue
  - brain
  - gateway
  - sender / body
- payload sanitize锛岄伩鍏?Error / function / 寰幆寮曠敤瀵艰嚧瑙傛祴閾惧穿婧?- maxRecords 涓婇檺娌荤悊

### 褰撳墠鍒ゆ柇
`@elysia-ai/observatory` 宸茬粡浠庘€滈鏋堕樁娈碘€濊繘鍏ワ細

> **涓婚摼瑙傛祴鎺ュ叆闃舵锛屽彲鏀拺 message 鈫?body.message.sent / failed 鐨勫叏閾捐矾 trace 鏌ヨ銆?*

### 褰撳墠浠嶆湭瀹屾垚
- 鎸佷箙鍖?trace store
- 鏇村畬鏁寸殑 trace summary / span / duration 缁熻
- Observatory UI / dashboard
- 涓?TraceRepository 鐨勯暱鏈熶簨瀹炴簮瀵归綈

---

## 3.9 鐢熷懡鐘舵€佸眰
### 褰撳墠宸插畬鎴?- `packages/@elysia-ai/perception`
  - 鐩戝惉 `stimulus.received`
  - 杈撳嚭瀹屾暣 `PerceptionResult`
  - 宸叉敮鎸佹剰鍥俱€佸疄浣撱€佹儏鎰熶笌 token 浼扮畻
- `packages/@elysia-ai/homeostasis`
  - 鐩戝惉 `life.loaded` 浠?`LifeStateRepository` 鎭㈠鎴栧垵濮嬪寲鐢熷懡绋虫€?  - 鐩戝惉 `perception.completed` 鎵ц tick
  - tick 鍚庡啓鍥?`LifeStateRepository`
  - 杈撳嚭 `HomeostasisState / HomeostasisDelta`
- `packages/@elysia-ai/cognition`
  - 鍩轰簬 `projection.routed` 瀵规瘡涓?routed life 鐙珛鎺ㄧ悊
  - 杈撳嚭 `CognitionResult`
  - 閫氳繃 `shouldEnterBehavior` 涓?behavior 鎻愪緵闂ㄦ帶淇″彿

### 褰撳墠鍒ゆ柇
鐢熷懡鐘舵€佸眰宸茬粡涓嶅啀鍙槸棰勭暀楠ㄦ灦锛岃€屾槸锛?
> **瀹屾垚绗竴杞寮忎富閾炬帴鍏ワ紝鍙奖鍝?behavior planning銆?*

### 褰撳墠浠嶆湭瀹屾垚
- MongoDB 鐪熷疄閮ㄧ讲鐜涓嬬殑杩炴帴鍙傛暟銆佽璇併€佽秴鏃躲€侀噸杩炰笌杩愮淮绛栫暐浠嶉渶缁х画娌荤悊
- Redis 杈呭姪灞傚皻鏈帴鍏ワ紙缂撳瓨銆侀攣銆佽皟搴﹁緟鍔╋級
- 鏇村畬鏁寸殑鐢熷懡鐘舵€佹ā鍨?- persona 鎻掍欢鑷韩浠嶄富瑕佸浜庨鏋堕樁娈?
---

## 鍥涖€佸綋鍓嶇湡姝ｇ殑涓绘垬鍦?
褰撳墠椤圭洰鏈€閲嶈鐨勫伐浣滐紝涓嶆槸缁х画澧炲姞鏂扮洰褰曪紝涔熶笉鏄户缁娊璞¤璁猴紝鑰屾槸锛?
> **鎶婂凡缁忓舰鎴愮殑涓诲共濂戠害銆佽緭鍏ヤ富閾俱€佽涓轰富閾俱€佽緭鍑轰富閾惧拰瑙傛祴涓婚摼涓€娆℃€ф寜姝ｅ紡鏋舵瀯鏀跺彛銆?*

褰撳墠涓绘垬鍦哄彲浠ユ鎷负 4 鏉＄嚎锛?
## 4.1 涓诲共濂戠害绾?缁х画绋冲畾骞惰ˉ榻愶細
- `Stimulus`
- `Projection`
- `BehaviorCandidate / BehaviorDecision`
- `behavior.candidates.generated`
- `behavior.selected`
- `projection.routed`
- `dialogue.*`
- `brain.*`
- `gateway.*`
- `sender.*`
- `DialogueTask / DialogueResult / DialogueService`
- `BrainService`
- `ModelGatewayService`
- `StimulusRepository / BondRepository / TraceRepository`

## 4.2 杈撳叆銆佽矾鐢变笌璁″垝绾?缁х画鏀跺彛锛?- body 涓殑 `StimulusBuilder / StimulusNormalizer`
- runtime 涓殑 life / habitat / projection routing
- behavior 涓殑 candidate / signal / decision 涓婚摼
- `ResponsePlan -> DialogueTask` 鐨勬寮忚浆鎹㈣竟鐣?
## 4.3 姝ｅ紡鎵ц涓庤緭鍑洪摼
缁х画鏀跺彛锛?- `DialogueService`
- `BrainService`
- `ModelGatewayService`
- `sender` 鐨勬寮忚緭鍑烘姇閫?- dialogue.completed 鍒?sender.completed / sender.failed 鐨勫畬鏁撮棴鐜?
## 4.4 瑙傛祴涓庤拷韪嚎
缁х画鏀跺彛锛?- `observatory` 鐨勪富閾句簨浠舵帴鍏?- `stimulusId` 涓轰富绱㈠紩鐨?trace 鑱氬悎
- runtime / behavior / dialogue / brain / gateway / sender / body 鐨勫叏閾捐矾鍙拷韪€?- snapshot 涓?recent events 鐨勪竴鑷存€?- 澶辫触閾捐矾鐨?`gateway.failed -> brain.failed -> dialogue.failed` 鍙鐩?
---

## 浜斻€佸綋鍓嶄笉璇ヤ紭鍏堝仛鐨勪簨鎯?
鍦ㄤ笂闈笁鏉′富绾挎病鏈夋敹鍙ｅ墠锛屼互涓嬪唴瀹逛笉搴旀姠浼樺厛绾э細

- 澶嶆潅 persona 璁捐
- 闀挎湡璁板繂绠楁硶缁嗚妭
- Mongo / Redis 鐢熶骇绾у疄鐜?- observatory 鍏ㄩ噺瀹炵幇
- 澶ч噺 UI / demo 瀵煎悜寮€鍙?- 涓轰簡鈥滃厛璺戦€氣€濊€屽紩鍏ュぇ閲忎复鏃?mock 涓婚摼璺?
杩欎簺鍐呭閮介噸瑕侊紝浣嗕笉璇ユ棭浜庝富閾惧绾︿笌姝ｅ紡鎵ц閾俱€?
---

## 鍏€佷笅涓€闃舵璁″垝

## 6.1 杩戞湡浼樺厛绾э紙褰撳墠寤鸿锛?
### 绗竴浼樺厛绾э細瀹屾暣涓婚摼闂幆涓€娆℃€ф敹鍙?鐩爣锛?- runtime / body / behavior / dialogue / brain / model-gateway / sender / observatory 鎸夋寮忚竟鐣屼竴娆℃€ф敹鍙?- 鎸?Koishi / Cordis service 鏈哄埗閲嶆柊鏍″噯 capability plugins锛屼笉鍐嶆妸 brain / model-gateway / observatory / persona 绛夌缁熺О涓衡€滃唴閮ㄨ兘鍔涘寘鈥?- 涓嶄娇鐢ㄢ€滄渶灏忓疄鐜扳€濃€滀复鏃跺崰浣嶁€濃€滀互鍚庡啀琛モ€濈殑绛栫暐
- 姣忎竴灞傞兘浠ユ寮忓璞°€佹寮忎簨浠躲€佹寮忔棩蹇椼€佹寮忔祴璇曚负鍑?
### 绗簩浼樺厛绾э細Projection / Life Routing 姝ｅ紡鍖?鐩爣锛?- `projection.routed`
- runtime life routing
- target life instances
- 澶?bot / 澶?habitat / 澶?life 涓嬧€滆皝鎰熺煡銆佽皝鍝嶅簲鈥濈殑姝ｅ紡瑙勫垯

### 绗笁浼樺厛绾э細鐢熷懡鐘舵€佸眰娣卞寲
鐩爣锛?- `perception`
- `homeostasis`
- `persona`
- `cognition`
宸插畬鎴愮涓€杞富閾炬帴鍏ワ紱涓嬩竴姝ュ簲娣卞寲鐘舵€佹ā鍨嬨€佹寔涔呭寲銆丄I enhanced interpretation 涓?persona 鎻掍欢鑳藉姏锛岃€屼笉鏄啀浣滀负鐙珛鍗犱綅鎺ㄨ繘銆?
### 绗洓浼樺厛绾э細鎸佷箙鍖栦笌浜嬪疄婧愭敹鍙?鐩爣锛?- repository 鎶借薄鐨勬寮忓疄鐜?- MongoDB / Redis 瑙掕壊鍒嗙
- 闀挎湡浜嬪疄婧愪笌鐭湡杈呭姪灞傛不鐞?
### 绗簲浼樺厛绾э細瀹夸富浜や粯涓庡懡鍚嶆敹鍙?鐩爣锛?- Koishi 瀹夸富鍏ュ彛鍖呬氦浠橀棴鐜?- capability plugin / runtime subservice / pure library 鍛藉悕涓庢枃妗ｄ竴鑷存€ф牎鍑?- exports / types / main / module 浜х墿瀵归綈
- 鍙傝€?`elysia-ai-koishi-mechanism-notes.md`銆乣elysia-ai-koishi-module-mapping.md` 涓?`elysia-ai-koishi-plugin-architecture-plan.md` 鎺ㄨ繘 Koishi 鎻掍欢鏋舵瀯淇

---

## 6.2 闃舵鎬ф墽琛岄『搴?寤鸿鎸変笅闈㈤『搴忔帹杩涳細

1. 鍏堝畬鎴愪富閾惧畬鏁撮棴鐜笌瑙傛祴闂幆鏀跺彛
2. 鍐嶅畬鎴?Projection / Life Routing 姝ｅ紡鍖?3. 鍐嶆繁鍖栫敓鍛界姸鎬佸眰涓庨暱鏈熻兘鍔涘眰
4. 鐒跺悗琛ユ寔涔呭寲涓庝簨瀹炴簮
5. 鏈€鍚庣粺涓€瀹夸富浜や粯涓庡懡鍚嶈竟鐣?
---

## 涓冦€佸綋鍓嶉樁娈典竴鍙ヨ瘽鎬荤粨

鎴嚦褰撳墠锛屾渶鍑嗙‘鐨勭姸鎬佹槸锛?
> **Elysia A.I. 宸茬粡瀹屾垚鏋舵瀯瀹氬瀷銆佸伐绋嬬粨鏋勫垎灞傛敹鍙ｃ€佽緭鍏ヤ富閾捐惤鍦般€佽涓鸿鍒掍富骞层€丅ehavior Execution Layer 绗竴杞寮忕紪鎺掋€乺untime scheduler 鑷姩璋冨害銆丮emory System v1銆丮emory Attribution & Routing v1銆丮emory Context Injection v1銆丮emory Relevance Selection v1銆丅ond System v1銆丅ond Context Injection v1銆丅ond Relevance Selection v1銆丅rain Context Budget Governance v1銆丠omeostasis Request Consumer v1銆乷bservatory trace 瑙傛祴闂幆銆丳rojection / Life Routing 姝ｅ紡鍖栦笌鐢熷懡鐘舵€佸眰绗竴杞富閾炬帴鍏ワ紱涓嬩竴姝ュ簲娣卞寲 AI-assisted relevance selection 鐨勭敓浜х骇娌荤悊銆佺敓鍛界姸鎬佹ā鍨嬨€乼oken budget 涓庢寔涔呭寲鑳藉姏銆?*

---

## 闄勫綍 A锛氫繚鐣欑殑鍘嗗彶缁忛獙

鏈妭淇濈暀浠嶆湁浠峰€间絾涓嶅簲缁х画姹℃煋姝ｆ枃涓荤嚎鐨勫巻鍙茶瘯閿欎俊鎭€?
### A.1 Koishi 瀹夸富鎺ュ叆缁忛獙
宸查獙璇佷互涓嬩簨瀹炰粛鐒舵湁鏁堬細

- 瀹夸富鍏ュ彛鍖呬笉鑳藉彧鎸夋櫘閫?workspace 鍖呭鐞?- 婧愮爜灞傜紪璇戦€氳繃涓嶇瓑浜?Koishi Loader 鍙ǔ瀹氬姞杞?- 鍙戝竷灞傚繀椤荤嫭绔嬭€冭檻鍏ュ彛瀛楁銆乪xports 涓庝骇鐗╁榻?
鍘嗗彶涓婄湡瀹炲嚭鐜拌繃锛?
- `ERR_UNSUPPORTED_DIR_IMPORT`
- `ERR_MODULE_NOT_FOUND`
- `TypeError: Class extends value #<Object> is not a constructor or null`

杩欎簺璁板綍璇存槑锛?- NodeNext 鐩稿瀵煎叆瑙勫垯涓嶈兘鏀炬澗
- 鎻掍欢浜や粯褰㈡€佸繀椤荤嫭绔嬫不鐞?- Loader 鍏煎鎬т笉鑳藉彧闈犳簮鐮佸眰淇

---

### A.2 monorepo 璺緞瑙ｆ瀽缁忛獙
褰撳墠宸茬粡楠岃瘉锛?
- `workspace + package name + exports + references`
  鍙互浣滀负涓诲共璺ㄥ寘瑙ｆ瀽鍩虹
- `postinstall + patch-tsconfig.js`
  鍙互浣滀负 Koishi 鏍瑰伐浣滃尯璇嗗埆宓屽 monorepo 鎻掍欢婧愮爜鐩綍鐨勫繀瑕佸吋瀹规満鍒?- 涓嶅簲缁х画渚濊禆鏍圭骇 `paths` 浣滀负 elysia-ai 鍐呴儴璺ㄥ寘瑙ｆ瀽鐨勯暱鏈熶富鏂规

---

### A.3 roadmap 缁存姢鍘熷垯
浠庣幇鍦ㄥ紑濮嬶紝鏈枃浠跺彧淇濈暀锛?- 褰撳墠鏈夋晥鐘舵€?- 褰撳墠涓绘垬鍦?- 涓嬩竴闃舵璁″垝
- 灏戦噺蹇呰鍘嗗彶缁忛獙闄勫綍

涓嶅啀缁х画鍫嗙Н锛?- 鈥滄湰杞柊澧炲唴瀹硅ˉ鍏呪€?- 鈥滃張涓€杞慨姝ｂ€?- 鈥滄棫鍒ゆ柇 + 鏂板垽鏂苟瀛樷€?- 澶ч噺閲嶅鐨勯樁娈垫€ц拷鍔犳枃鏈?
---

## Memory/Bond 独立插件化收口

- `@elysia-ai/memory` 与 `@elysia-ai/bond` 已作为 capability plugins 纳入规划与实现方向。
- runtime 不再长期拥有 memory/bond 默认实现，只保留 deprecated 兼容字段供迁移期测试和旧调用方读取。
- dialogue 优先通过 `ctx['elysia.memory']` / `ctx['elysia.bond']` 获取上下文 provider；插件缺失时主对话链路降级运行。
- 后续新增 repository provider、context selector、consolidation policy 等配置必须归属各自插件，不回填到 runtime 配置。
## Phase 36 Update
- This phase closes Koishi service boundaries before introducing new AI features.
- Priority order: service registration, dependency gates, package metadata, and regression coverage.
- `memory` and `bond` remain independent capability plugins and should not be folded back into runtime defaults.
- Next phase should focus on removing migration-only compatibility once the formal `elysia.*` service surface is stable.

## Phase 37 Update: Formal Multi-Plugin Delivery
- Phase 37 focuses on making every Elysia capability a first-class Koishi plugin with typed service facade, package exports tests, and composition tests.
- No central aggregator package is introduced in this phase.
- Future production storage/provider work should build on this multi-plugin service contract.

## Phase 39: top-level Koishi plugin boundary materialization

- Status: implemented. Top-level capability packages now expose official Koishi `name / Config / apply`; internal `@elysia-ai/*` packages no longer expose official `name / apply`.
- Verification: Phase 39 boundary tests, package metadata tests, dependency gates, multi-plugin composition, package exports, Phase 4, Phase 7, and Phase 35 regressions pass.
- Build governance: `yarn check:packages` runs package-level TypeScript build checks inside `external/elysia-ai` without changing Koishi root configuration.
- Next phase should focus on replacing delegation-style wrappers with thinner factory-based wrappers where it improves maintainability, without changing public plugin package names.

## Phase 40: Koishi dependency moved to top-level plugins

- Status: implemented. Capability implementation packages no longer import Koishi directly and expose factory-style `create<Capability>PluginRuntime` entries.
- Top-level `packages/elysia-ai-*` plugins own `Schema`, official `name / Config / apply`, and Koishi-facing package exports.
- Internal `@elysia-ai/*` packages no longer expose `applyInternal` and remain non-loader implementation libraries.
- Verification: `yarn check:packages`, Phase 40 boundary/export tests, dependency gates, Phase 4, Phase 7, Phase 35, and Phase 37 composition regressions pass.
## Phase 41 Completion

Phase 41 is complete. Internal capability packages now follow pure factory boundaries:
- Factories receive explicit dependencies such as runtime, brain, model gateway, config, and logger.
- Internal packages return service facades plus dispose callbacks.
- Koishi `Context`, `Schema`, dependency lookup, service registration, legacy aliases, and lifecycle binding are owned by top-level `packages/elysia-ai-*` plugins.
- `@elysia-ai/shared` may still host shared Koishi-facing helpers, but capability implementation packages must not call those helpers directly.

## Phase 42 Quality Gates

Phase 42 converts the plugin architecture into a delivery baseline:
- Factory contract tests cover `memory`, `bond`, `cognition`, `homeostasis`, `persona`, `perception`, `dialogue`, `behavior`, `brain`, `model-gateway`, and `observatory`.
- Top-level assembly tests verify canonical `elysia.*` service registration, legacy alias compatibility, dispose cleanup, optional dependency degradation, and memory/bond runtime compatibility field cleanup.
- Package metadata tests require every top-level plugin to declare Koishi metadata, package exports, peer Koishi dependency, and `lib` delivery files.
- Package exports tests import built top-level plugin entries for `name / Config / apply`, while internal packages are checked for factory exports rather than official plugin entries.
- Documentation maps top-level plugins to internal packages, services, dependencies, configuration ownership, and recommended compositions.

Completion gate:
- `yarn test`
- `yarn check:packages`
- `yarn check:source-hygiene`

## Phase 43 Preview: Production Providers And Repositories

Phase 43 should start only after Phase 42 quality gates are stable. Planned scope:
- Production memory and bond repository providers such as database-backed storage and migration-safe repository interfaces.
- Model gateway provider expansion with health checks, retry/fallback policy hardening, and provider diagnostics.
- Runtime configuration ergonomics for provider selection without moving capability ownership back into runtime.
- Observatory dashboards/queries for provider health, side-effect consumers, and cross-plugin event traces.

Out of scope for Phase 42 and earlier phases:
- Central aggregator plugin.
- Koishi app root workspace or root `tsconfig.json` changes.
- Renaming package names, service names, or existing event names.
## Phase 43 Progress

Phase 43 introduces the first production delivery layer after the Phase 42 quality gate:
- `memory` and `bond` now accept injected repository factories and include Mongo-compatible repository implementations for contract testing.
- `model-gateway` now supports production `providers` + `providerSlots` config while retaining legacy direct `slots` compatibility.
- Provider API keys can be resolved through `apiKeyEnv`; missing env values fail fast before service registration.
- Repository diagnostics events are part of the core event map and are observable through `observatory` queries by `component` and `repositoryType`.

Phase 43 intentionally does not add a central aggregator, does not move capability config into runtime, and does not modify Koishi root workspace loading. Phase 44 should focus on operational tooling: real Mongo factory wiring examples, migration helpers, dynamic config UX, and richer observatory dashboards.
## Phase 44 Progress

Phase 44 closes the first production-readiness loop:
- Top-level memory and bond plugins export Mongo-compatible repository factory helpers.
- Top-level memory, bond, and model-gateway plugins expose validation functions used before service registration.
- Observatory snapshots include repository analytics alongside existing gateway analytics.
- Tests lock secret hygiene, fail-fast validation, helper factory behavior, and external Mongo collection lifecycle ownership.

Phase 45 should focus on operator-facing capabilities: management UI, richer dashboard views, dynamic provider/repository configuration UX, Redis-backed scheduling/cache helpers, and vector retrieval experiments.

## Phase 45 Progress

Phase 45 introduces the first operator-facing runtime surface without adding a central aggregator or web dashboard:

- `@elysia-ai/observatory` exposes `getOperationalSnapshot()` with gateway analytics, repository analytics, loaded component hints, and sanitized recent failure summaries.
- The top-level observatory plugin registers `elysia.status`, `elysia.gateway.status`, `elysia.repository.status`, and `elysia.preflight` commands.
- Shared preflight result types now provide stable `{ ok, errors, warnings, diagnostics }` output for production readiness checks.
- Top-level memory, bond, and model-gateway plugins expose preflight helpers that reuse Phase 44 validation and keep secrets out of errors and command output.
- Sanitization redacts API key/token/secret-like fields and summarizes message content by length instead of exposing full prompts or user messages.

Phase 45 intentionally does not implement hot reload. Provider definitions, API keys, repository factories, and external collection ownership still require plugin restart/re-apply. Phase 46 can now focus on one of these tracks: Koishi console/dashboard UI, provider slot reload design, Redis/cache helpers, vector retrieval experiments, or repository migration tooling.

