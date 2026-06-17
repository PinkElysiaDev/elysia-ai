# Elysia A.I. 配置项分层与可读性方案（2026-06）

## 背景与目标

对照代码核实：13 个 koishi-plugin 中 11 个有实质 Config schema，但存在两类问题：
1. **可读性不足**：behavior（5 字段 0 描述）、cognition（11 字段仅 1 描述）、perception、homeostasis 旧字段等大量"裸参数"——用户看到 `salienceLengthFactor: 0.001` 不知何意。
2. **无分层**：所有字段平铺，把"开关类基础项"和"行为调参类高级项"混在一起，普通用户被劝退，高级用户找不到重点。

**目标**：用 Koishi Schema 原生能力做三件事，零运行逻辑变更（纯元数据）：
- 给每个字段补**面向用户的中文 description**（解释"调它会怎样"，而非内部变量名直译）。
- 按 **基础 / 高级（行为调参）** 两层分组，高级层默认折叠。
- 把若干内部权重，在描述层面翻译成用户能直觉理解的"抽象概念入口"。

## Koishi Schema 分层手段（技术选型）

- **分组折叠**：用嵌套 `Schema.object({...}).description('高级：行为调参')` 把高级字段收进一个子对象，Koishi 控制台默认渲染为可折叠分组。
- **保持扁平兼容**：现有代码读取的是扁平 config（如 `config.salienceDirectMentionBonus`）。**不改字段路径**——分组仅用于 UI 呈现时，需评估是否会改变 `config.xxx` 访问路径。
  - **关键决策**：Koishi 的嵌套 `Schema.object` 会改变访问路径（变成 `config.advanced.xxx`）。为零行为变更，**第一阶段只补 description 不做物理嵌套**；分层通过 `Schema.intersect([基础, 高级])` 实现——intersect 在类型与运行时都是扁平合并，但控制台按 intersect 成员分组渲染。这样 `config.xxx` 路径不变。
- **次要项弱化**：`role('secret')`（已用于 mongo uri）、`.hidden()`（极少数纯内部项）。

## 分层设计（逐插件）

> 标记：【基】= 基础组（默认展开）；【高】= 高级/行为调参组（默认折叠）。
> 描述均改写为面向用户的中文。

### behavior（行为节奏）—— 当前 0 描述，重点改造
- 【基】`enableReply` → "是否允许主动回复消息（关闭后只观察不出声）"
- 【高】`directWindowMs` → "被直接点名后，多久内的后续消息合并为一次回应（毫秒）"
- 【高】`userBufferedWindowMs` → "同一用户连续发言的攒话窗口（毫秒），越大越倾向凑齐再回"
- 【高】`threadBufferedWindowMs` → "同一话题串的攒话窗口（毫秒）"
- 【高】`habitatBufferedWindowMs` → "整个群聊场景的攒话窗口（毫秒）"

### cognition（认知/显著性）—— 10 个 salience 裸参数，重点改造
- 【基】`behaviorThreshold` → "回应意愿阈值：显著性高于此值才会进入行为决策，越低越话痨"
- 【基】`aiEnhanced` → "启用 AI 增强认知（需配置模型槽位）"
- 【高】`recentConversationLimit` → "参与显著性判断的最近对话条数"
- 【高】`salienceDirectMentionBonus` → "被 @ 点名时提升的回应意愿"
- 【高】`salienceDirectMessageBonus` → "私聊场景提升的回应意愿"
- 【高】`salienceReplyBonus` → "消息是对本体的回复时提升的回应意愿"
- 【高】`salienceQuestionBonus` → "消息是疑问句时提升的回应意愿"
- 【高】`salienceLengthFactor` → "消息长度对回应意愿的加权系数"
- 【高】`aiFallbackToRuleBased` / `aiMinSalience` / `aiModelSlot`（AI 相关，归 AI 子组）

### perception（感知）
- 【基】`enabledIntentClassify` / `enabledEntityExtract` / `enabledSentiment` → "是否启用 意图识别 / 实体抽取 / 情感分析"
- 【基】`aiEnhanced` → "启用 AI 增强感知"
- 【高】`maxInputTokens` → "单次感知分析的最大输入 token"
- 【高】`aiFallbackToRuleBased` / `aiMinTextLength` / `aiModelSlot`（AI 子组）

### homeostasis（生命状态）—— 18 字段，旧 decay/initial 批无描述
- 【基】`restoreOnStartup`（已有描述）
- 【高·初始值】`initialEnergy/Mood/Sociability/Curiosity` → "初始 能量/心情/社交倾向/好奇心（0~1）"
- 【高·衰减】`energyDecayPerTick` 等 4 项 → "每次 tick 时 xxx 的衰减幅度"
- 【高·恢复】`*Baseline` / `recoveryFactor`（D3 已补描述，保留）
- 【高·边界】`maxValue/minValue/responseThresholdMin/Max` → 状态与阈值上下限

### model-gateway —— 已 42 描述，仅做中文化与分组确认
- 【基】`providers` / `providerSlots` / `defaultSlot`
- 【高】`retry` / `circuitBreaker` / `fallback` / 兼容用 `slots`

### 其余（描述中文化 + 轻分层）
- **memory / bond**：【基】`enabled` `contextLimit`；【高】`repository`（mongo 连接，已 secret）。英文描述改中文。
- **brain**：【基】`systemPrompt` `defaultModelSlot` `contextWindow`；【高】`contextBudget`（已分组，描述中文化）。
- **persona**：4 项基础，描述中文化。
- **dialogue**：`enabled` `memoryLimit`，中文化。
- **runtime**：【基】`manifestPath`；【高】`stateRepository`（已分组，描述中文化）。
- **observatory**：`enabled` `maxRecords` 补描述。
- **body**：无配置（IO 插件），不动。

## 执行阶段

### 阶段 C1 · 描述中文化 + 补全（零结构变更，最低风险）
给所有裸字段补面向用户的中文 `.description()`；英文描述改写为中文。**不动任何字段路径**。
出口：`check:packages` 编译 + `vitest` 全绿（描述是元数据，不影响测试）。

### 阶段 C2 · 高级分层（用 Schema.intersect，保持扁平路径）
将每个插件的字段按【基】/【高】用 `Schema.intersect([base, advanced])` 分组渲染，advanced 成员在控制台默认折叠。
**验证 `config.xxx` 访问路径不变**（intersect 是扁平合并）——逐插件 apply() 不需改。
出口：编译 + 测试全绿；人工核对 Koishi 控制台渲染出"基础/高级"两组。

### 阶段 C3（可选）· 抽象概念封装
评估是否把若干 salience 权重聚合为"活跃度""话痨程度"等高层旋钮（需在 apply 层做映射，非纯元数据，风险升级，单独评估）。

## 风险与边界
- C1 纯元数据，零风险。
- C2 关键风险点：确认 `Schema.intersect` 不改运行时访问路径。若 Koishi 版本的 intersect 行为不符，退回"仅描述 + 字段顺序编排"，不做物理分组。
- C3 涉及运行逻辑，默认不做，待确认。
