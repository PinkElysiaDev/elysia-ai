# Elysia A.I. Logging / Debug 规范

## 文档用途

本文档定义 Elysia A.I. 的统一日志规范，目标是：

1. 在 **info** 级别下提供系统是否正常工作的基础状态信息
2. 在 **debug** 级别下提供足够定位问题的内部执行细节
3. 控制日志噪音，避免把调试日志写成“原始数据倾倒”
4. 为后续 `runtime/body/perception/homeostasis/cognition/persona/behavior/dialogue/brain/model-gateway/observatory` 提供统一日志约束

本文档只讨论**日志等级、字段、内容边界、敏感信息约束**，不讨论：

- Koishi 插件启用顺序
- 宿主是否成功加载
- mock 测试策略
- 真实模型调用策略

这些问题由 Koishi 宿主、用户观察和其他文档负责。

---

## 1. 总体原则

## 1.1 日志的目标不是“尽可能多”，而是“足够解释当前状态”

Elysia A.I. 的日志必须回答两个问题：

1. 系统当前是否正常工作？
2. 当系统异常时，开发者能否靠日志定位到哪一层出了问题？

日志应当服务于“可理解”和“可追踪”，而不是单纯输出原始数据。

---

## 1.2 `info` 看状态，`debug` 看过程

### `info`
用于表示：
- 当前系统状态
- 关键生命周期变化
- 关键动作的开始 / 完成 / 失败
- 面向人类快速阅读的摘要

### `debug`
用于表示：
- 内部处理过程
- 关键对象的结构化快照
- 决策分支
- 状态前后变化
- 用于排查 bug 的详细上下文

---

## 1.3 默认不输出敏感信息和超长原始内容

即使在 `debug` 下，也不允许无差别输出：

- 完整 API Key
- 完整 Authorization / Token
- Cookie
- 原始二进制 / base64 大块内容
- 未裁剪的大段 prompt
- 未裁剪的完整模型响应
- 用户隐私内容的原始全集

如果确实需要输出，必须：
- 脱敏
- 裁剪
- 摘要化
- 结构化

---

## 1.4 所有日志都应尽可能带上下文标识

建议日志尽可能带这些字段中的一部分：

- `plugin`
- `phase`
- `event`
- `lifeId`
- `projectionId`
- `habitatId`
- `threadId`
- `stimulusId`
- `botId`
- `platform`
- `model`
- `provider`
- `durationMs`

日志的目标不是“好看”，而是能串起同一条处理链。

---

## 2. 日志等级定义

## 2.1 `info`

### 定义
`info` 用于记录系统对外可感知的、值得长期保留的状态与工作摘要。

### 适合记录
- 插件已启动 / 已停止
- adapter 已注册
- runtime 已启动 / 已停止
- manifest 加载成功 / 失败
- 收到一条 stimulus（摘要）
- 生成一次行为决策（摘要）
- 完成一次 dialogue 生成（摘要）
- 模型请求成功 / 失败（摘要）
- 数据持久化成功 / 失败（摘要）

### 不适合记录
- 每一步函数调用细节
- 大量中间对象
- 全量 request / response body
- 高频循环日志

### 目标效果
只看 `info`，开发者应该能知道：

> 系统现在有没有活着，正在做什么，大概在哪一步卡住了。

---

## 2.2 `debug`

### 定义
`debug` 用于记录内部执行过程、状态变化和决策依据，服务于问题定位。

### 适合记录
- session → platformMessage 映射详情
- platformMessage → stimulus 转换详情
- perception 显著性评分与筛选原因
- homeostasis 状态前后变化
- behavior candidate 列表和选择理由
- brain 请求摘要与模型返回摘要
- model-gateway 路由决策过程
- repository 查询参数和结果摘要
- event bus 关键事件触发链

### 不适合记录
- 每个小函数都打一条日志
- 原始超长文本、原始图像内容、未经处理的对象全集
- 完整秘密配置

### 目标效果
打开 `debug` 后，开发者应该能回答：

> 这条输入是如何一步步变成最终输出的，中间每一层做了什么判断。

---

## 3. 推荐日志字段约定

推荐所有日志遵循“消息 + 结构化字段”的风格。

## 3.1 基础字段

- `plugin`: 当前日志来自哪个包
- `phase`: 当前处理阶段
- `event`: 当前事件名
- `message`: 面向人类的摘要文字

## 3.2 生命体上下文字段

- `lifeId`
- `projectionId`
- `habitatId`
- `threadId`
- `stimulusId`

## 3.3 平台上下文字段

- `platform`
- `botId`
- `guildId`
- `channelId`
- `userId`

## 3.4 模型调用字段

- `provider`
- `model`
- `requestId`
- `durationMs`
- `tokenUsageSummary`

---

## 4. 各层日志职责规范

在当前工程结构下，日志来源需要区分两类角色：

### 宿主入口包
- `koishi-plugin-elysia-ai-runtime`
- `koishi-plugin-elysia-ai-body`

这类日志更偏向：
- 宿主接入
- 生命周期
- Loader 入口
- 输入输出桥接

### 内部能力包
- `@elysia-ai/behavior`
- `@elysia-ai/dialogue`
- `@elysia-ai/brain`
- `@elysia-ai/model-gateway`
- `@elysia-ai/perception`
- `@elysia-ai/homeostasis`
- `@elysia-ai/observatory`

这类日志更偏向：
- 规划
- 推理
- 对话任务执行
- 模型路由
- 状态变化
- 观测与 trace

## 4.1 `runtime`

### `info` 应输出
- runtime started / stopped
- manifest loaded summary
- 注册了多少 life / projection
- 接收到关键 stimulus 事件摘要
- lifecycle 状态变化

### `debug` 应输出
- event bus emit / listener 执行链
- registry 变化细节
- scheduler 任务分发细节
- runtime context 装配信息
- life/projection 路由判断过程（未来）

---

## 4.2 `body`

### `info` 应输出
- body adapter registered
- 收到一条外部输入（摘要）
- 一条输出已发送（摘要）

### `debug` 应输出
- session 的关键字段摘要
- platformMessage 结构
- stimulus 转换详情
- sender payload 摘要
- 适配器丢弃消息的原因（如果有）

---

## 4.3 `perception`

### `info` 应输出
- 一条刺激通过 / 未通过筛选
- 感知层完成处理（摘要）

### `debug` 应输出
- attention score
- filter reason
- 进入后续处理的依据
- 被丢弃 stimulus 的原因

---

## 4.4 `homeostasis`

### `info` 应输出
- 明显状态变化（例如能量过低、社交驱动上升）
- 一次状态更新完成摘要

### `debug` 应输出
- energy / loneliness / socialDrive 等字段前后变化
- 状态变化的输入因子
- tick 计算细节

---

## 4.5 `behavior`

### `info` 应输出
- 最终行为决策摘要
- 结果类型（reply / ignore / observe / proactive）

### `debug` 应输出
- candidate 列表
- 每个候选行为的评分或优先级
- 最终行为被选中的原因
- 被放弃候选的原因

---

## 4.6 `dialogue`

### `info` 应输出
- dialogue 已生成
- 输出长度 / 目标 / 发送方式摘要

### `debug` 应输出
- dialogue 渲染输入摘要
- 风格参数
- 模板变量摘要
- 最终文本草稿（必要时裁剪）

---

## 4.7 `brain`

### `info` 应输出
- brain request started
- brain request completed / failed
- 模型名、耗时、token 摘要

### `debug` 应输出
- request payload 摘要
- prompt/input 裁剪版
- response 解析过程
- fallback / retry 原因

---

## 4.8 `model-gateway`

### `info` 应输出
- 路由到哪个 provider / model
- 请求成功 / 失败
- 耗时与结果摘要

### `debug` 应输出
- 路由选择过程
- provider config 摘要（脱敏）
- request body 摘要
- response body 摘要（裁剪）
- retry / fallback / downgrade 过程

---

## 4.9 `observatory`

### `info` 应输出
- 状态快照已生成
- inspect 请求完成
- trace 导出完成

### `debug` 应输出
- trace 聚合过程
- snapshot 构造细节
- 调试查询条件与结果摘要

---

## 5. 强制敏感信息规则

以下内容**禁止直接输出到日志**：

- 完整 API Key
- 完整 token / cookie / secret
- 原始 Authorization 头
- 未裁剪的大段 prompt
- 未裁剪的模型完整响应
- 原始图片二进制 / base64 全量
- 用户的高敏感识别信息（如果后续出现）

### 推荐做法
- API Key 只显示前 4 位和后 2 位
- prompt / response 最多显示前 N 字符
- 复杂对象只打印关键字段
- 超长数组只打印长度和前若干项

---

## 6. 推荐配置项

建议后续所有宿主入口包最终统一支持以下日志配置：

### 方案 A：简单模式
```ts
debugMode: boolean
```

- `false`：默认只输出 `info`
- `true`：额外输出 `debug`

### 方案 B：标准模式
```ts
logLevel: 'info' | 'debug'
```

### 可选增强
```ts
logPayloadPreviewLength: number
redactSensitiveFields: boolean
```

当前阶段不强制实现，但文档中先确立这个方向。

---

## 7. 推荐日志输出风格

建议统一采用：

- 简短消息文本
- 结构化字段对象
- 不把重要信息埋进一长串字符串里

### 推荐例子
```ts
logger.info({
  plugin: 'koishi-plugin-elysia-ai-runtime',
  phase: 'startup',
  lifeCount: 3,
}, 'runtime started')
```

```ts
logger.debug({
  plugin: 'koishi-plugin-elysia-ai-body',
  phase: 'normalize',
  stimulusId,
  platform,
  botId,
  habitatId,
}, 'converted platform message into stimulus')
```

---

## 8. 最低落地要求

在真正开始补代码日志前，至少应保证：

### `info` 级别最低覆盖
- runtime 启停
- body 输入
- behavior 决策摘要
- dialogue 生成摘要
- model-gateway 请求结果摘要

### `debug` 级别最低覆盖
- stimulus 转换
- behavior 选择过程
- homeostasis 状态变化
- model-gateway 路由过程

---

## 9. 结论

Elysia A.I. 的日志系统不应只是“打印点位”，而应承担：

- 运行状态确认
- 问题定位
- 生命周期追踪
- observatory 的未来数据来源

因此，日志规范必须从现在开始统一，不允许每一层各打各的、随意输出。

后续若要实现代码层日志，应以本文档为统一规范来源。
