# Elysia A.I. 事件目录

> 事件 = 已发生的事实（通知侧）。命令侧处理步骤走阶段管线
> （见《插件开发指南》§1）。本目录按类别整理 `CoreEventMap` 全部事件；
> 类型定义的唯一事实来源是
> `packages/@elysia-ai/core/src/bus/event-map.ts`。

订阅方式：`eventBus.on('<name>', handler)`（监听者错误隔离：单个订阅者
抛错不影响其他订阅者，也不冒泡回发布方）；观测全部事件用
`eventBus.onAny((event, payload) => ...)`。

## 管线位置速查

```
刺激段：stimulus.received → perception.completed
路由：projection.routed
生命段：cognition.event.recorded → behavior.trigger.fired →
        behavior.execution.plan.created → behavior.instruction →
        behavior.execution.started/.action.*/.completed/.failed →
        dialogue.task.created → generation.requested → started →
        generated → output.created → completed/failed
发送：sender.started/completed/failed
旁路：memory.* / bond.* / homeostasis.* （订阅 behavior.*.update.requested）
```

## Runtime / 生命周期

| 事件 | 载荷要点 | 发射方 | 订阅方示例 |
|---|---|---|---|
| `runtime.starting` / `runtime.started` | state | runtime | observatory |
| `runtime.stopping` / `runtime.stopped` | state | runtime | observatory |
| `life.loaded` | lifeId, type, config（含 extensions） | runtime | 消费每生命配置的插件 |

## 刺激与投影

| 事件 | 载荷要点 | 发射方 | 说明 |
|---|---|---|---|
| `stimulus.received` | stimulusId, stimulus | runtime | 刺激进入主链（事实；阶段侧为 stimulus.received 段） |
| `projection.routed` | stimulusId, routing{lifeIds,...} | runtime | 哪些生命体命中 |
| `projection.rule.updated` / `.disabled` / `.removed` | ruleId, rule | projection-rule-service | 投影规则变更 |

## 感知 / 内稳态 / 认知

| 事件 | 载荷要点 | 发射方 |
|---|---|---|
| `perception.completed` | stimulusId, result（intent/entities/sentiment/context） | perception |
| `homeostasis.updated` | lifeInstanceId, state（energy/mood/...）, delta | homeostasis |
| `homeostasis.update.failed` | requestId, request, error | homeostasis |
| `cognition.event.recorded` | stimulusId, lifeId, habitatId, event（TriggerEvent 事件行） | cognition |

## 行为

| 事件 | 载荷要点 | 发射方 |
|---|---|---|
| `behavior.trigger.fired` | lifeId, habitatId, source（batcher/instant/scheduled/manual）, reason, stimulusId | behavior |
| `behavior.execution.plan.created` | planId, plan | behavior |
| `behavior.instruction` | instruction（actions[]） | behavior |
| `behavior.execution.started/.completed/.failed` | planId, plan | behavior-execution |
| `behavior.execution.action.started/.completed/.failed` | planId, actionId, action | behavior-execution |
| `behavior.memory.update.requested` | lifeId, request | behavior-execution |
| `behavior.bond.update.requested` | lifeId, request | behavior-execution |
| `behavior.homeostasis.update.requested` | lifeId, request | behavior-execution |

## 对话 / 大脑 / 网关

| 事件 | 载荷要点 | 发射方 |
|---|---|---|
| `dialogue.task.created` | task | behavior-execution |
| `dialogue.generation.requested` | task, context | dialogue |
| `dialogue.started` / `.generated` | task / task, result | dialogue |
| `dialogue.output.created` | output（含回发路由） | dialogue |
| `dialogue.completed` / `.failed` | task, result / task, error | dialogue |
| `brain.requested` / `.completed` / `.failed` | request / response, error | brain |
| `gateway.requested` / `.responded` / `.failed` | request / response, error, diagnostics | model-gateway |

## 记忆 / 关系（旁路）

memory 与 bond 事件互为镜像：`*.created` / `*.updated` / `*.update.failed` /
`*.retrieved` / `*.retrieve.failed` / `*.context.requested` / `.selected` /
`.failed` / `.fallback` / `*.consolidation.requested` / `.consolidated` /
`.consolidation.failed`（memory 独有）/ `*.relevance.selection.*`。

## 仓储诊断 / 发送

`repository.initialized` / `.query.failed` / `.write.failed` /
`.fallback-to-memory`；`sender.started` / `.completed` / `.failed`；
`body.message.sent` / `.failed`。

## 扩展事件（第三方）

第三方通过声明合并添加（不改 core），命名建议 `<插件短名>.<动作>`：

```ts
declare module '@elysia-ai/core' {
  interface CoreEventMap {
    'emotion.evaluated': { stimulusId: string, mood: number, arousal: number }
  }
}
```
