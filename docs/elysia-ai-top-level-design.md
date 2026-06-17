# Elysia A.I. 顶层设计说明

## 文档用途

本文档只负责回答三个问题：

1. **Elysia A.I. 到底是什么**
2. **它为什么要这样设计**
3. **后续开发中哪些顶层边界不能被破坏**

本文档**不是**：

- 详细接口手册
- 插件开发规范
- Koishi 集成操作说明
- 阶段性施工记录
- 代码审查流程说明

这些内容分别由其他文档承担：

- `elysia-ai-core-contracts.md`
- `elysia-ai-plugin-development-spec.md`
- `elysia-ai-koishi-integration-guide.md`
- `elysia-ai-development-roadmap.md`
- `elysia-ai-code-review-methodology.md`

因此，本文档只保留**顶层架构判断、核心抽象、分层职责与不可变原则**。

---

## 1. 项目定位

**Elysia A.I.** 不是传统意义上的聊天插件，也不是围绕“会话历史 + prompt 拼接 + 模型回复”构建出来的对话外壳。

它的目标是：

> **在 Koishi 生态中构建一个用于托管、维持、调度和扩展虚拟生命体的运行框架。**

这里的重点不是“回复一句话”，而是：

- 一个生命体如何持续存在
- 它如何感知外部世界
- 它如何维持内部状态
- 它如何形成关系、记忆与目标
- 它如何在不同 bot / 平台 / habitat 中投射自己
- 它如何把内部行为转化为外部表达

因此，Elysia A.I. 的核心不是“对话”，而是：

> **虚拟生命体状态的长期连续演化。**

对话只是外显行为的一种，不是系统中心。

---

## 2. 设计目标

## 2.1 生命体优先，而不是对话优先

系统维护的主语是 `LifeInstance`，而不是会话轮次。
一个生命体拥有连续状态，而不是每次收到消息后临时生成一段回复。

---

## 2.2 原生支持多 Bot / 多 Habitat / 多 Projection

系统必须天然支持：

- 一个 runtime 管理多个 bot
- 一个 bot 承载多个生命体
- 一个生命体在多个 bot / habitat 中投射
- 同一生命体在不同环境下表现不同

Bot 只是身体节点，不是业务主语。

---

## 2.3 代码与配置解耦

能力插件只负责定义通用机制，例如：

- 如何感知刺激
- 如何更新内稳态
- 如何形成行为候选
- 如何渲染表达

配置层只负责声明生命体如何存在，例如：

- 哪些生命体存在
- 它们挂载哪些能力
- 它们在哪些 habitat 中活动
- 它们采用什么人格、策略和 brain

---

## 2.4 去 ChatLuna 依赖

Elysia A.I. 不应围绕 ChatLuna 的：

- room
- history
- prompt 中心模型
- 单轮问答抽象

来设计架构。

它必须拥有自己的生命运行抽象，不把自己退化成“高级聊天壳”。

---

## 2.5 可持续扩展、可长期协作

系统必须支持：

- 多窗口并行开发
- 后续插件继续注入能力
- 能力层逐步演进
- 不因为局部实现方便而污染顶层结构

文档体系本身是工程基础设施的一部分，而不是附属材料。

---

## 3. 核心设计原则

## 3.1 状态优先于输出

先维护生命体状态，再决定是否表达。
输出只是状态演化后的一个结果，而不是唯一目的。

---

## 3.2 刺激优先于消息

系统接收的是 `Stimulus`，而不是单纯“聊天消息”。
消息只是刺激的一种来源。

---

## 3.3 行为优先于回复

生命体的输出不必总是“回复一句话”。
它首先要决定“做什么”，再决定“怎么说”。

---

## 3.4 连续性优先于回合性

系统不能按“一轮问答完成一次处理”的思路构建。
它应该按生命过程连续演化的方式思考。

---

## 3.5 关系优先于上下文容器

不以 room 作为核心状态容器。
比 room 更重要的是：

- 生命体是谁
- 它在哪个 habitat 中
- 它与谁有怎样的 bond
- 当前属于哪条 thread

---

## 3.6 配置声明存在方式，不承担代码逻辑

配置只负责“存在声明”，不负责写死业务逻辑。
能力行为的真正实现只能放在代码层。

---

## 3.7 保留生命层结构，不为了省事压平分层

可以合并层内过碎模块，但不能抹掉生命层本身。
否则系统会重新退化成若干个大杂烩插件。

---

## 3.8 MongoDB 是事实源，Redis 是辅助层

- MongoDB：长期事实存储
- Redis：缓存、锁、调度辅助、短期信号

Redis 不能成为生命状态的真相来源。

---

## 3.9 宿主入口包必须遵守 Koishi 宿主约束

`runtime` 和 `body` 不是普通内部库，而是会被 Koishi Loader 直接加载的宿主入口包。
因此它们必须按 Koishi 插件标准进行交付，而不是只按普通 workspace 包处理。

具体打包与宿主约束见：
- `elysia-ai-koishi-integration-guide.md`

---

## 3.10 Prompt 组合必须保留人格优先级

Brain 层的 system prompt 不是任意字符串拼接点，必须遵守稳定顺序：

1. `BrainRequest.systemPrompt`
2. persona system prompt（包含 traits / tone）
3. config fallback system prompt
4. memory context
5. bond context
6. context budget truncation

persona 存在时必须替代 config fallback；memory / bond 只能作为附加上下文影响事实、语气、边界与熟悉度，不能覆盖 persona，也不能重新引入 fallback prompt。

---

## 4. 核心抽象模型

Elysia A.I. 放弃 room 中心模型，采用以下抽象描述系统。

## 4.1 LifeInstance

`LifeInstance` 表示一个虚拟生命体实例。
它是整个系统的主语。

一个生命体至少应具备：

- 身份
- 内部状态
- 记忆
- 人格
- 关系网络
- 行为倾向
- 生命周期数据

它不是一次对话，而是一个持续存在的个体。

---

## 4.2 Habitat

`Habitat` 表示生命体长期活动的环境或栖息地。
它不等于“聊天房间”，而是更稳定的环境抽象。

Habitat 可以对应：

- 某个群
- 某个私聊
- 某个平台频道
- 某个剧情空间
- 某个 bot 下的一个存在区域

---

## 4.3 Bond

`Bond` 表示生命体与其他主体之间的关系纽带。

它可以承载：

- familiarity
- intimacy
- trust
- tension
- dependence
- shared history

Bond 比“最近聊天历史”更能决定生命体如何对待某个对象。

---

## 4.4 Thread

`Thread` 表示持续发生的一条事件线、主题线或剧情线。

它用于承载：

- 某个长期话题
- 某段关系推进
- 某个任务跟进
- 某次冲突
- 某条剧情分支

Thread 不是状态主语，但它是连续性的重要支架。

---

## 4.5 Projection

`Projection` 表示一个生命体在某个 habitat / body / bot 下的投射。

同一个生命体可以在不同环境里：

- 更克制
- 更热情
- 更正式
- 更私密

Projection 用于描述这种差异化存在方式。

---

## 4.6 Stimulus

`Stimulus` 表示系统感知到的刺激。
消息只是刺激的一种来源。

刺激可以包括：

- 文本消息
- 图片
- @
- 引用
- 时间事件
- 空闲事件
- 活跃度变化
- 关系变化
- 目标提醒
- 内部记忆唤起

系统真正处理的是刺激，而不是“原始平台消息”。

---

## 4.7 BehaviorCandidate

`BehaviorCandidate` 表示一个候选行为。

系统面对刺激时不应直接生成文本，而应先形成若干候选行为，例如：

- reply
- ignore
- observe
- ask
- quote
- proactive-topic
- memory-only
- state-update

最终再由行为层选择最合适的行为，再交给 dialogue 层表达。

---

## 5. 总体分层结构

Elysia A.I. 的分层是按生命体运行逻辑来设计的，而不是按传统 Web 应用层次来设计的。

当前正式逻辑层次包括：

- `core`
- `runtime`
- `body`
- `perception`
- `homeostasis`
- `cognition`
- `persona`
- `behavior`
- `dialogue`
- `observatory`
- `brain`
- `model-gateway`
- `shared`

其中：

- `core` 是协议层
- `runtime` 是横切运行层
- `body ~ dialogue` 是生命处理主链
- `perception / homeostasis / cognition / persona` 是生命状态与认知上下文层
- `behavior` 会综合 projection routing 与生命状态上下文进行行为规划
- `runtime` 承接 behavior execution layer，将 behavior 的计划编排为 dialogue、scheduler、memory、bond、homeostasis 等正式执行动作
- `memory` 已形成第一轮长期记忆契约与 runtime 默认实现，用于承接 behavior side-effect 并为后续 cognition / dialogue context enrichment 提供事实源
- `bond` 已形成第一轮长期关系契约与 runtime 默认实现，用于承接 behavior side-effect 并为后续 cognition / dialogue context enrichment 提供关系事实源
- `homeostasis` 已形成第一轮 request consumer 闭环，runtime 默认 `HomeostasisService` 可消费 behavior execution side-effect 并写回生命状态事实源
- `observatory` 是观测和养成层
- `brain / model-gateway` 是认知执行支撑层

当前第一轮正式主链已经形成：

```txt
body -> runtime.receiveStimulus()
  -> stimulus.received
  -> perception.completed / homeostasis.updated
  -> projection.routed
  -> cognition.reasoning / cognition.completed
  -> behavior.selected / behavior.instruction
  -> behavior execution plan
  -> runtime behavior execution / scheduler / memory service / bond service / homeostasis service
  -> dialogue / brain / model-gateway
  -> dialogue.output.created
  -> body sender
```

其中 `perception / homeostasis / cognition` 的结果已经进入 `core` 正式契约，并可影响 `behavior planning`。

---

## 6. 工程结构与包角色分层

逻辑分层并不等于工程目录分层。
当前代码结构已经明确把 **内部能力包** 与 **Koishi 宿主入口包** 区分为两类不同工程角色。

后续阅读本文档时必须区分三件事：

- **逻辑层名称**：例如 `core`、`behavior`、`dialogue`
- **真实工程路径**：例如 `packages/@elysia-ai/core`
- **真实包名 / import 名称**：以各包 `package.json` 的 `name` 字段为准，例如 `@elysia-ai/core`

早期文档曾把路径名、逻辑层名和包名直接等同，这是不准确的。
当前工程事实以代码、`package.json`、`tsconfig` 和 Koishi monorepo 可运行结构为准。

### 6.1 内部能力 / 协议包

位于：

```txt
packages/@elysia-ai/*
```

包括：

- `@elysia-ai/core`
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

这些包的职责是：

- 定义协议、抽象和正式对象
- 承载内部能力实现
- 为宿主入口包和其他能力包提供可组合的内部依赖

它们**不是** Koishi Loader 直接加载的宿主入口包。
虽然真实包名中包含 `koishi-plugin` 片段，但这是当前 Koishi monorepo / workspace 工程结构下的包命名事实，不能据此判断它们会被 Koishi Loader 直接加载。是否属于宿主入口包，应以真实路径、入口导出、Koishi 装配方式和 `package.json` 交付字段共同判断。

---

### 6.2 Koishi 宿主入口包

位于：

```txt
packages/elysia-ai-runtime
packages/elysia-ai-body
```

对外发布名为：

- `koishi-plugin-elysia-ai-runtime`
- `koishi-plugin-elysia-ai-body`

这些包的职责是：

- 暴露 `apply()` 供 Koishi Loader 直接加载
- 承担宿主接入与运行时装配
- 把内部能力层接到 Koishi 宿主生命周期上

它们是 **Koishi 插件入口**，而不是普通内部库。

---

### 6.3 工程结构结论

从现在开始，必须把下面两类东西分清楚：

#### 内部能力包
- 用于协议、能力、状态、行为、表达、认知
- Phase 38 package split: top-level Koishi plugins use `koishi-plugin-elysia-ai-*`; internal implementation packages use `@elysia-ai/*`.
- 是否为内部能力包不能只看包名中的 `koishi-plugin`，应以其工程角色和加载方式判断

#### 宿主入口包
- 用于被 Koishi Loader 直接加载
- 由 `koishi-plugin-*` 表达其宿主插件身份

这条分层是当前结构收口后的正式工程结论。
后续不应再把宿主入口包和平铺内部包重新混放在同一层目录里。

---

## 7. 各层职责说明

## 7.1 core

`core` 是系统的公共协议层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/core
```

当前真实包名为：

```txt
@elysia-ai/core
```

它负责定义：

- 统一抽象
- 类型与 schema
- event bus 接口
- repository 接口
- brain / model-gateway 抽象
- 插件扩展协议

它不负责具体业务行为，而负责“全系统说同一种语言”。

---

## 7.2 runtime

`runtime` 是横切运行层。
当前宿主入口工程位置位于：

```txt
packages/elysia-ai-runtime
```

它负责：

- 生命周期管理
- 多生命体装配
- 多 Bot 调度
- 注册中心
- 事件总线默认实现
- scheduler
- behavior execution service
- memory service 默认实现与运行时挂载
- bond service 默认实现与运行时挂载
- homeostasis service 默认实现与运行时挂载
- manifest 装载
- 运行时上下文

它不负责具体人格或行为策略，但负责组织它们发生。

---

## 7.3 body

`body` 是生命体与外部平台世界接触的身体层。
当前宿主入口工程位置位于：

```txt
packages/elysia-ai-body
```

它负责：

- Koishi session / event 接入
- 平台消息 → Stimulus
- 行为结果 → 平台发送
- bot 身份映射
- 外部输入输出桥接

它只负责“接世界”和“出世界”，不应负责决定行为策略。

---

## 7.4 perception

`perception` 是感知层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/perception
```

它负责：

- 对刺激做标准化
- 提取轻量意图、实体、情绪等感知信息
- 估算输入 token 与刺激上下文
- 通过 `perception.completed` 输出 `PerceptionResult`

当前第一轮实现采用规则 / 启发式方式，不依赖模型网关。
它不负责最终回复，也不负责长期人格。

---

## 7.5 homeostasis

`homeostasis` 是内稳态层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/homeostasis
```

它负责维护生命体内部平衡，例如：

- energy
- mood
- sociability
- curiosity
- responseThreshold

当前第一轮实现会在 `life.loaded` 时初始化状态，并在 `perception.completed` 后执行一次稳态 tick，随后通过 `homeostasis.updated` 输出 `HomeostasisState / HomeostasisDelta`。
同时 runtime 已提供 `DefaultHomeostasisService`，可消费 behavior execution 发出的 `behavior.homeostasis.update.requested`，将执行层产生的稳态变化写回 `LifeStateRepository<HomeostasisState>`，并在成功 / 失败时输出 `homeostasis.updated / homeostasis.update.failed` 观测事件。
它决定生命体当前“愿不愿意回应、回应强度如何”。

---

## 7.6 cognition

`cognition` 是认知层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/cognition
```

它负责：

- 情境建模
- 读取 persona 与最近对话上下文
- 计算 stimulus 对每个 routed life 的显著性与连续性
- 输出 `CognitionResult`
- 通过 `shouldEnterBehavior` 为 behavior 提供门控信号

当前 cognition 基于 `projection.routed` 运行，因此多 life 场景下每个 life 会得到独立认知结果。
它不直接承担宿主调度，也不直接替代 dialogue 表达。

---

## 7.7 persona

`persona` 是人格与社会层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/persona
```

它负责：

- 核心人格
- 情绪惯性
- 关系风格
- 身份叙事
- 长期倾向

这一层决定生命体“是谁”，以及“它如何成为它自己”。

---

## 7.8 behavior

`behavior` 决定生命体“做什么”。
当前真实工程位置位于：

```txt
packages/@elysia-ai/behavior
```

它负责：

- 生成候选行为
- 选择候选行为
- 决定是否行动
- 决定主动/被动策略
- 消费 perception / cognition / homeostasis 上下文
- 将 `ResponsePlan` 展开为 `BehaviorExecutionPlan`
- 对每个 routed life 独立发出 `behavior.instruction`

当前第一轮生命状态接入后，behavior 会使用 `CognitionResult.shouldEnterBehavior` 进行门控，并使用感知、认知和内稳态信号调整行为规划。
它不直接负责文本润色，也不直接写入长期记忆事实源，而负责行为选择与执行计划本身。

---

## 7.9 dialogue

`dialogue` 决定生命体“怎么表达”。
当前真实工程位置位于：

```txt
packages/@elysia-ai/dialogue
```

它负责：

- 把行为意图渲染为文本或表达形式
- 文风、语气、结构
- 引用、动作、旁白等表达方式
- 与 brain 配合生成语言内容

它不决定该不该说，而负责“怎么说”。

---

## 7.10 observatory

`observatory` 是观察与养成层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/observatory
```

它负责：

- 查看生命体状态
- 查看记忆、关系与 trace
- 调试系统行为
- 提供人工干预入口
- 支撑长期养成和观察

它是开发者与培育者理解系统行为的重要窗口。

---

## 7.11 brain

`brain` 是认知执行抽象层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/brain
```

它负责定义：

- 认知请求抽象
- 认知响应抽象
- 统一 brain 能力接口

它不负责 provider 路由与底层渠道管理。

---

## 7.12 model-gateway

`model-gateway` 是模型请求与 provider 适配层。
当前真实工程位置位于：

```txt
packages/@elysia-ai/model-gateway
```

它负责：

- provider 配置
- endpoint / channel 管理
- 路由与请求下发
- provider 差异收敛
- 统一底层模型调用方式

它回答的是“请求怎么发出去”，而不是“生命体想什么”。

---

## 8. 技术栈结论

Elysia A.I. 当前明确采用的技术方向为：

- TypeScript
- Node.js
- Koishi
- Yarn workspace
- Turborepo
- Zod
- YAML
- MongoDB
- Redis
- Vitest
- pino

这些结论是顶层约束，不应被局部便利随意推翻。

---

## 9. 宿主与交付层面的高层结论

Elysia A.I. 不是只在 monorepo 内部自转的工程。
它是运行在 Koishi 宿主上的插件体系。

因此必须接受一个现实：

> **源码层可编译，不等于宿主层可加载。**

特别是：

- `elysia-ai-runtime`
- `elysia-ai-body`

这两个包是 Koishi 宿主入口包，不是普通内部库。
它们必须最终以 Koishi 标准插件包形态交付。

具体打包与加载规则不在本文档展开，详见：

- `elysia-ai-koishi-integration-guide.md`

本文只保留这个高层结论：

> **宿主入口包必须按 Koishi 插件标准交付，而不是只按普通 monorepo 内部包处理。**

---

## 10. 扩展生态结论

Elysia A.I. 从一开始就不是封闭的一次性实现，而是一个长期可扩展生态。

因此需要同时具备：

- 配置命名空间隔离
- 流水线注入点
- 插件 manifest
- pipeline context
- trace 能力
- 文档化约束

这些扩展机制的详细规则不在本文档展开，详见：

- `elysia-ai-plugin-development-spec.md`

本文只保留结论：

> **Elysia A.I. 必须能让官方层与第三方插件共同参与生命运行，而不破坏系统主干。**

---

## 11. 不可破坏的顶层约束

后续任何实现如果违背以下判断，都意味着架构正在退化：

1. 不得把系统重新退化成聊天插件
2. 不得把 room 重新抬回核心抽象
3. 不得让 Bot 成为业务主语
4. 不得让配置文件承担代码逻辑
5. 不得让 Redis 成为事实真相来源
6. 不得把 brain 与 model-gateway 混为一体
7. 不得为了方便而抹掉生命层结构
8. 不得把宿主入口包当作普通内部库处理
9. 不得把“编译通过”误判为“宿主可交付”
10. 不得绕开文档体系做大规模方向变更
11. 不得重新把宿主入口包与内部能力包平铺混放

---

## 12. 总结

Elysia A.I. 的本质不是“一个会聊天的插件集合”，而是：

> **一个围绕虚拟生命体持续存在、持续感知、持续调节、持续认知、持续表达而设计的运行框架。**

在这个框架里：

- 对话不是中心，生命体才是中心
- Bot 不是主语，Projection 才是关键
- room 不是核心容器，Habitat / Bond / Thread 才是连续性基础
- 模型不是系统本体，brain 只是器官
- 文档不是附属品，而是架构持续稳定的保护层

只要后续开发持续遵守这些判断，Elysia A.I. 就不会退化回普通聊天插件，而会稳定向“虚拟生命运行框架”演进。

---

## 相关文档索引

如需继续深入，请按职责查看：

- 核心契约与接口：`elysia-ai-core-contracts.md`
- Koishi 集成与打包：`elysia-ai-koishi-integration-guide.md`
- Koishi 工作机制研究：`elysia-ai-koishi-mechanism-notes.md`
- Elysia / Koishi 模块映射：`elysia-ai-koishi-module-mapping.md`
- Koishi 插件架构修订计划：`elysia-ai-koishi-plugin-architecture-plan.md`
- 插件扩展规范：`elysia-ai-plugin-development-spec.md`
- 当前进度与施工计划：`elysia-ai-development-roadmap.md`
- 代码审查方法：`elysia-ai-code-review-methodology.md`
