# Elysia A.I. Koishi 插件架构计划

## 1. 总体结论

Elysia A.I. 不应只有 `runtime` 和 `body` 两个 Koishi 插件。正确结构是：runtime 作为 kernel，body 作为 adapter，其余可配置能力以 capability plugin 交付。

```txt
Koishi App
  ├─ Kernel Plugin
  │   └─ koishi-plugin-elysia-ai-runtime
  ├─ Adapter Plugin
  │   └─ koishi-plugin-elysia-ai-body
  ├─ Capability Plugins
  │   ├─ @elysia-ai/memory
  │   ├─ @elysia-ai/bond
  │   ├─ @elysia-ai/model-gateway
  │   ├─ @elysia-ai/brain
  │   ├─ @elysia-ai/dialogue
  │   ├─ @elysia-ai/behavior
  │   ├─ @elysia-ai/perception
  │   ├─ @elysia-ai/cognition
  │   ├─ @elysia-ai/homeostasis
  │   ├─ @elysia-ai/persona
  │   └─ @elysia-ai/observatory
  └─ Pure Libraries
      ├─ @elysia-ai/core
      └─ @elysia-ai/shared
```

## 2. Runtime kernel 边界

runtime 只负责：

- lifecycle 与 event bus
- life / habitat / persona registry
- scheduler kernel 与 projection kernel
- base state repository wiring
- manifest loading

runtime 不再直接创建 memory/bond 默认实现。迁移期兼容字段只允许由 memory/bond 插件安装后回填，并标记为 deprecated。

## 3. Memory / Bond 插件化

已落位包：

- `@elysia-ai/memory` 注册 `elysia.memory`，消费 `behavior.memory.update.requested`。
- `@elysia-ai/bond` 注册 `elysia.bond`，消费 `behavior.bond.update.requested`。

能力归属：

- memory：repository type、memory update、query/retrieve、attribution、context injection、relevance selection、consolidation。
- bond：repository type、bond update、query/retrieve、context injection、relevance selection、metric update policy。

## 4. 上游接入规则

- behavior 只生产 `behavior.memory.update.requested` / `behavior.bond.update.requested`，不直接依赖 memory/bond 实现。
- dialogue 优先通过 `ctx['elysia.memory']` / `ctx['elysia.bond']` 读取 context provider。
- brain 只消费 `BrainRequest.memoryContext` / `BrainRequest.bondContext`，不反向依赖 memory/bond 插件。
- memory/bond 未安装时，主 dialogue 链路应降级运行；side-effect 无消费者不应导致主回复失败。

## 5. 配置归属

- runtime：manifest、state repository、scheduler/projection kernel、lifecycle。
- memory：repository、attribution、context provider、relevance selector、consolidation。
- bond：repository、context provider、relevance selector、metric update policy。
- model-gateway：provider、slot、retry、fallback、health。
- brain：system prompt、context budget、capability policy。
- dialogue：conversation window、context injection 开关。
- behavior：reply gating、buffer window、execution planning。
- observatory：retention、query、analytics、debug command。

## 6. Package metadata 规则

Capability plugins 应补齐：

- `peerDependencies.koishi`
- `koishi.description`
- `koishi.service.implements`（如果提供 service）
- `main/types/exports` 与构建产物一致

`core` / `shared` 保持 pure library，不写 Koishi plugin metadata。

## 7. 验证要求

- service 注册测试：插件 apply 后可访问 `elysia.memory` / `elysia.bond`。
- event 测试：memory/bond 插件消费 behavior side-effect request。
- context 测试：dialogue 通过 capability service 注入 memory/bond context。
- regression：Phase 4、Phase 7、Phase 20/21、Phase 24–27、Phase 35 必须保持通过。

## 8. 后续开发顺序

1. 将其余 capability plugins 按 memory/bond 模式补齐正式 service 与 package metadata。
2. 用 `inject` 收口必需依赖：brain → model-gateway、dialogue → brain、body → runtime。
3. 增加 dispose / hot reload 测试，确保事件监听与 service 引用可释放。
4. 增加真实 package exports 构建验证，不只依赖 vitest alias。
5. 逐步移除 runtime 上的 deprecated memory/bond 兼容字段。
## Phase 36 Decision: Formal Koishi Services
- Every loadable Elysia capability plugin must expose a formal `elysia.*` service name when it provides runtime-accessible capability.
- Legacy `elysia-ai-*` names remain readable during migration and are registered through the shared service helper.
- Required dependency lookup must use formal name first and legacy fallback second.
- Plugin initialization must not continue after a required runtime, gateway, brain, or dialogue dependency is missing.
- `core` and `shared` stay pure libraries and must not add Koishi plugin metadata.
