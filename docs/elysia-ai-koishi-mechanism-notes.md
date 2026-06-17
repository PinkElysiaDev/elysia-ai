# Koishi 工作机制研究笔记

## 文档用途

本文档记录在重新设计 Elysia A.I. Koishi 插件架构前，对 Koishi / Cordis 工作机制的阅读结论。

研究资料来源：

- Koishi 官方开发指南：https://koishi.chat/zh-CN/guide/
- 配置构型：https://koishi.chat/zh-CN/guide/plugin/schema
- 生命周期：https://koishi.chat/zh-CN/guide/plugin/lifecycle
- 服务与依赖：https://koishi.chat/zh-CN/guide/plugin/service
- Koishi GitHub：https://github.com/koishijs/koishi
- 本地安装源码：`node_modules/koishi`、`node_modules/@koishijs/core`、`node_modules/@cordisjs/core`、`node_modules/@koishijs/loader`
- 本地结构参照：`external/service-more`

---

## 1. Koishi 的底层不是“普通插件数组”，而是 Cordis Context / Plugin / Service 体系

Koishi 运行在 Cordis 的上下文与插件系统之上。

核心事实：

- `ctx.plugin()` 接受 function、class 或 object-with-`apply` 三种插件形态。
- object 插件必须提供 `apply(ctx, config)`。
- 插件可以声明 `name`、`Config`、`inject`、`reusable`、`reactive` 等元属性。
- `ctx.inject()` 本质上会创建带依赖声明的插件 fork，等依赖服务可用后再执行回调。

源码依据：

- `node_modules/@cordisjs/core/src/registry.ts`
  - `Plugin.Function / Plugin.Constructor / Plugin.Object`
  - `Plugin.Object.apply`
  - `ctx.plugin()`
  - `ctx.inject()`

这意味着 Elysia 的能力包不应该只靠手工读写 `ctx['elysia-ai-*']` 协作。长期稳定方案应该优先使用 Koishi/Cordis service 与 inject 机制表达依赖关系。

---

## 2. Koishi Service 是能力暴露的正式机制

Cordis `Service` 的关键行为：

- 构造时会 `ctx.provide(name)`，声明服务名。
- 到 `ready` 生命周期后会执行 `start()` 并 `ctx.set(name, service)`。
- 到 `dispose` 生命周期后执行 `stop()`。
- `immediate` service 可以更早暴露。
- 同名 service 不能被重复注册，否则会触发 `service xxx has been registered`。

源码依据：

- `node_modules/@cordisjs/core/src/service.ts`
- `node_modules/@cordisjs/core/src/reflect.ts`

对 Elysia 的结论：

- `model-gateway`、`brain`、`observatory` 这类被其他插件依赖的能力，应优先以 service 形式暴露。
- `runtime` 应提供基础 kernel service，而不是把所有能力都塞进一个运行时对象。
- memory / bond 已选择作为独立 capability plugins 暴露：`elysia.memory` 与 `elysia.bond` 是正式服务边界，runtime 只保留迁移期兼容回填。

---

## 3. Koishi Context 初始化了大量内置服务

本地 Koishi 4.18.11 中，`@koishijs/core` 的 `Context` 会初始化：

- `schema`
- `$processor`
- `i18n`
- `permissions`
- `model`
- `http`
- `$commander`
- `minato.Database`
- `Koishi` service 本身

源码依据：

- `node_modules/@koishijs/core/src/context.ts`

对 Elysia 的结论：

- Elysia 的配置 schema 应遵守 Koishi 的 `Schema` 风格，而不是只作为 TypeScript 类型存在。
- 命令、服务、数据库、HTTP 等不应重新发明一套运行时抽象；应尽量接入 Koishi 已有服务。
- 若 Elysia 需要数据库事实源，应考虑 Koishi / Minato / database plugin 生态，而不是只按裸 Mongo client 思路设计。

---

## 4. 配置不是普通 JSON，而是 Koishi Console / Loader 可理解的 Schema

官方指南强调插件通常暴露：

```ts
export const name = 'plugin-name'
export interface Config {}
export const Config = Schema.object({})
export function apply(ctx: Context, config: Config) {}
```

对 Elysia 的结论：

- 每个可配置能力插件都应有正式 `Config`。
- `Config` 应描述控制台配置项，而不只是内部构造参数。
- `model-gateway` 的 provider/slot、`brain` 的 prompt/budget、`observatory` 的 retention/query、`persona` 的加载策略，都应该进入对应插件的 `Config`。
- runtime 只保留 kernel / manifest / repository wiring，不应吞掉所有能力配置。

---

## 5. 生命周期与热重载要求插件必须可释放

Koishi / Cordis 插件通过 scope 维护副作用。插件应把事件监听、service 注册、定时器、命令注册等副作用挂到当前 scope，使 dispose 时可清理。

对 Elysia 的结论：

- `eventBus.on()` 返回的 dispose 必须在 `ctx.on('dispose')` 或 `ctx.effect()` 中释放。
- scheduler、model health tracker、observatory store、repository connections 都必须明确 dispose 行为。
- 不应在模块顶层保存跨 reload 的全局状态，除非明确设计为进程级缓存。

---

## 6. package metadata 决定 Koishi 生态识别，而不只是 TypeScript 编译

Koishi 包生态识别依赖 package metadata。

本地 `koishi/package.json` 中声明的生态模式包括：

- `@koishijs/plugin-*`
- `koishi-plugin-*`

`service-more` 的插件包通常具有：

- `name: koishi-plugin-*`
- `main: lib/index.js`
- `typings: lib/index.d.ts`
- `files: ["lib", "src"]`
- `peerDependencies.koishi`
- `koishi.description`
- 对服务类插件，`koishi.service.implements`

对 Elysia 的结论：

- Phase 38 package split: top-level Koishi plugins use `koishi-plugin-elysia-ai-*`; internal implementation packages use `@elysia-ai/*`.
- runtime/body 已有更完整 Koishi metadata，但其他 capability plugins 也应补齐。
- core/shared 不应补 Koishi plugin metadata，它们是纯库。

---

## 7. service-more 的可借鉴点与不可照搬点

可借鉴：

- root package 简洁，仅保留 workspaces 与 postinstall。
- 插件放在 `packages/*`。
- 每个插件包独立声明 Koishi metadata。
- postinstall patch 根 Koishi 项目的 `tsconfig.json`，方便源码开发。

不可照搬：

- Elysia 不是一组平行小插件，而是有 runtime kernel、event bus、life model、memory/bond/brain/gateway 的分层系统。
- Elysia 需要同时处理“Koishi 插件身份”和“内部能力契约”。
- Elysia 的 memory/bond/brain/model-gateway 需要 service 依赖关系，不适合全部平铺为互不相关的小插件。

---

## 8. 对当前 Elysia 规划的修正

旧判断：

> runtime/body 是宿主入口包，其他是内部能力包。

修正后判断：

> runtime/body 是关键入口，但不是唯一 Koishi 插件。Elysia 应区分 kernel plugin、adapter plugin、capability plugin、runtime subservice 与 pure library；memory/bond 属于 capability plugin。

其中：

- capability plugin 可以被 Koishi Loader 配置、启停和热重载。
- service 是 capability plugin 对其他插件暴露能力的首选机制。
- runtime 不应替代所有 capability plugin 的配置入口。

---

## 9. 后续必须回答的问题

1. 每个 Elysia 模块是否应该成为 Koishi plugin？
2. 如果是 plugin，它是否还应该注册 service？
3. service 名称是什么？是否需要 `koishi.service.implements`？
4. 配置属于 runtime，还是属于对应 capability plugin？
5. 插件缺少依赖时应 `inject` 等待，还是日志报错退出？
6. memory/bond 已拆成独立 service plugin，后续问题变为 service 生命周期、配置 schema 与外部 repository provider 如何扩展。

这些问题在 `elysia-ai-koishi-module-mapping.md` 与 `elysia-ai-koishi-plugin-architecture-plan.md` 中给出当前建议。
