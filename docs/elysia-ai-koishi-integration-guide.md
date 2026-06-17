# Elysia A.I. Koishi 集成指南

## 文档用途

本文档用于说明 **Elysia A.I. 在 Koishi 宿主中的当前正式集成要求**。  
它回答的核心问题是：

- 哪些包属于 Koishi 宿主入口包
- 哪些包只是内部能力 / 协议包
- 当前推荐的目录结构应该是什么
- `service-more` 为什么能在 Koishi 根工作区里正常工作
- `elysia-ai` 当前采用什么机制与 Koishi 根工作区对接
- 如何判断一个包已经达到“可被 Koishi 稳定加载”的标准

**本文件正文只保留当前有效的集成规范。**  
历史踩坑、旧方案和试错经验，统一保留在文末附录中。

---

## 一、文档适用范围

本文档主要适用于以下两类包：

### 1. Koishi 宿主入口包
会被 Koishi Loader 直接加载的包，例如：

- `packages/elysia-ai-runtime`
- `packages/elysia-ai-body`

这些包最终对外发布为：

- `koishi-plugin-elysia-ai-runtime`
- `koishi-plugin-elysia-ai-body`

### 2. 内部能力 / 协议包
不会被 Koishi Loader 直接加载，但会被宿主入口包与其他能力包依赖的包，例如：

- `packages/@elysia-ai/core`
- `packages/@elysia-ai/shared`
- `packages/@elysia-ai/behavior`
- `packages/@elysia-ai/dialogue`
- `packages/@elysia-ai/brain`
- `packages/@elysia-ai/model-gateway`

这两类包的工程要求不同，不能混为一谈。

当前主链运行依赖 Koishi Context 上的服务挂载：

```txt
ctx['elysia-ai-runtime']
ctx['elysia-ai-observatory']
ctx['elysia-ai-model-gateway']
ctx['elysia-ai-brain']
ctx['elysia-ai-dialogue']
```

其中 runtime 由宿主入口包提供，observatory / model-gateway / brain / dialogue 由内部能力包在 `apply()` 阶段挂载。

---

## 二、当前有效结论

## 2.0 代码事实优先原则

本文档中的工程判断必须以当前真实代码结构为准：

- 真实包名以各包 `package.json` 的 `name` 字段为准
- 真实 import 方式以当前可通过测试和构建的源码为准
- 目录路径、逻辑层名称和 npm package name 不能直接等同
- 早期文档中把 `packages/@elysia-ai/core` 推导为 `@elysia-ai/core` 的写法不符合当前 Koishi monorepo 工程事实

Phase 38 package split: top-level Koishi plugins use `koishi-plugin-elysia-ai-*`; internal implementation packages use `@elysia-ai/*`.

```txt
packages/@elysia-ai/core          -> @elysia-ai/core
packages/@elysia-ai/behavior      -> @elysia-ai/behavior
packages/@elysia-ai/dialogue      -> @elysia-ai/dialogue
packages/@elysia-ai/model-gateway -> @elysia-ai/model-gateway
```

是否属于 Koishi Loader 直接加载的宿主入口包，不能只看包名中是否包含 `koishi-plugin`，而应以真实路径、入口导出、Koishi 装配方式和交付字段共同判断。

## 2.1 Koishi 只认“最终交付形态”
Koishi 不关心你内部使用的是：

- Turborepo
- tsc
- esbuild
- tsup
- yakumo

它真正关心的是：

> **最终插件包能否以标准 Node 模块形态被成功解析、加载并执行 `apply()`。**

因此，对 Koishi 集成来说，最终验收标准不是“源码能编译”，而是：

- 包可被解析
- 包入口正确
- Loader 能稳定加载
- 插件能在宿主中正常启动

---

## 2.2 宿主入口包必须按 Koishi 插件包处理
对于 `elysia-ai-runtime` / `elysia-ai-body` 这类入口包，当前正式要求是：

- 具备标准插件元信息
- 具备稳定的 `exports`
- 具备可被 Koishi Loader 使用的入口产物
- 满足宿主环境下的加载要求

也就是说：

> **宿主入口包不是普通 workspace 内部包，而是正式插件交付物。**

---

## 2.3 内部能力包与宿主入口包必须分开治理
当前应明确区分：

### 宿主入口包
特点：
- 会被 Koishi 直接加载
- 需要宿主兼容
- 需要交付级产物规范
- 对外使用 `koishi-plugin-*` 命名

### 内部能力 / 协议包
特点：
- 只作为 workspace 内部依赖
- 重点是稳定导出与类型边界
- 不直接承担 Loader 直接加载责任
- Phase 38 package split: top-level Koishi plugins use `koishi-plugin-elysia-ai-*`; internal implementation packages use `@elysia-ai/*`.
- 包名包含 `koishi-plugin` 片段不等于它就是宿主入口包

---

## 三、当前推荐的目录结构

当前推荐的 Koishi 兼容目录结构如下：

```txt
external/elysia-ai/
  package.json
  tsconfig.json
  turbo.json
  scripts/
    patch-tsconfig.js
  packages/
    @elysia-ai/
      core/
      behavior/
      brain/
      dialogue/
      cognition/
      homeostasis/
      model-gateway/
      observatory/
      perception/
      persona/
      shared/
    elysia-ai-runtime/
    elysia-ai-body/
```

### 这套结构表达的含义

#### `packages/@elysia-ai/*`
用于承载：
- 协议
- 抽象
- 内部能力层
- 认知 / 行为 / 表达 / 状态逻辑

#### `packages/elysia-ai-runtime`
用于承载：
- Koishi 宿主 runtime 入口
- 生命周期装配
- 事件总线与运行时上下文接入

#### `packages/elysia-ai-body`
用于承载：
- Koishi 外部输入接入
- platformMessage / Stimulus 桥接
- 宿主层输入输出边界

---

## 四、为什么 `service-more` 能工作，而 `elysia-ai` 也必须这样接入

## 4.1 关键事实
`service-more` 能在 Koishi 根工作区里正常被识别，不是因为“嵌套 monorepo 天然会被理解”，而是因为它在安装时会自动修改 Koishi 根 `tsconfig.json`。

它的机制是：

1. 根 `package.json` 中定义：
   - `postinstall`
2. `postinstall` 执行：
   - `scripts/patch-tsconfig.js`
3. 脚本自动把：

```txt
external/service-more/packages/*/src
```

插入到 Koishi 根 `tsconfig.json` 的：

```jsonc
"koishi-plugin-*": [...]
```

配置里

这样根工作区才能把 `service-more/packages/*/src` 当成插件源码目录来识别。

---

## 4.2 `elysia-ai` 当前采用同样策略
`elysia-ai` 当前也采用：

- `postinstall`
- `scripts/patch-tsconfig.js`

在安装阶段向 Koishi 根 `tsconfig.json` 注入：

```txt
external/elysia-ai/packages/*/src
```

其目的不是“魔法补救”，而是：

> **显式告诉 Koishi 根工作区：  
> `elysia-ai` 的插件源码入口就在 `external/elysia-ai/packages/*/src`。**

---

## 4.3 为什么必须这样做
Koishi 根工作区的 `tsconfig.json` 不是自动扫描任意嵌套 monorepo 来发现插件源码目录的。  
它依赖：

- 固定的 `paths`
- 固定的命名模式
- 固定的插件源码路径约定

因此，像 `service-more` 和 `elysia-ai` 这种“仓库内再分包”的 monorepo，要想在 Koishi 根工作区中像普通插件一样工作，就必须：

- 要么天然落入根 tsconfig 现有路径规则
- 要么像 `service-more` 一样，在安装时自动补路径映射

---

## 五、为什么旧结构不够好

旧结构的核心问题不是某一行字段错了，而是：

### 5.1 宿主入口包和内部能力包平铺
旧结构里：
- `core`
- `runtime`
- `body`
- `behavior`
- `brain`
- `dialogue`

都平铺在 `packages/*` 下

这会导致：

- 目录层级不能表达包角色差异
- 宿主入口包和内部协议包在工程上被误当成同类
- 构建、命名、workspace 和 loader 语义容易混在一起

---

### 5.2 工作区边界与包职责边界不一致
旧结构虽然能工作一部分，但它没有清楚表达：

- 哪些包是 Koishi Loader 直接加载的
- 哪些包只是内部能力层
- 哪些包应该输出 Koishi 插件交付物
- 哪些包只需稳定导出类型与接口

---

### 5.3 根 tsconfig / paths / build 更难自然对齐
一旦宿主入口包和内部包混在一起，就会让：

- 根 `tsconfig.json` 的路径映射
- build 入口
- workspace 管理
- 宿主交付验证

都变得更难写清楚。

因此，当前结构重构的本质，不是重命名，而是：

> **把“内部能力 / 协议包”和“Koishi 宿主入口包”在工程上正式分层。**

---

## 六、当前推荐的工程策略

## 6.1 monorepo 可以继续使用
Turborepo / Yarn workspace 可以继续保留。  
它们负责的是：

- workspace 管理
- 构建顺序
- 任务编排

但要明确：

> **monorepo 工具只负责编排，不替代插件交付规范。**

---

## 6.2 源码层与交付层必须分开看待

### 源码层
目标：
- TypeScript 正确
- NodeNext 兼容
- 跨包引用清晰
- 相对导入合法

当前要求包括：
- `.js` 显式扩展名
- 避免目录导入歧义
- 测试文件不参与正式构建

### 交付层
目标：
- 产物能被 Koishi Loader 稳定加载
- `package.json` 的入口字段与产物匹配
- 发布形态满足宿主消费要求

**源码层通过 ≠ 宿主可交付。**

---

## 七、宿主入口包的正式要求

下面这部分是当前应遵守的正式规范。

### 7.1 `package.json` 入口字段
宿主入口包应明确提供：

```json
{
  "main": "lib/index.cjs",
  "module": "lib/index.mjs",
  "typings": "lib/index.d.ts"
}
```

---

### 7.2 `exports` 应明确声明
推荐形式：

```json
{
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "require": "./lib/index.cjs",
      "import": "./lib/index.mjs"
    },
    "./package.json": "./package.json"
  }
}
```

---

### 7.3 `peerDependencies` 应正确声明 `koishi`
对使用 Koishi API 的宿主入口包，应声明：

```json
{
  "peerDependencies": {
    "koishi": "^4.18.0"
  }
}
```

通常也会在 `devDependencies` 中保留 `koishi`，用于开发与类型支持。

---

### 7.4 `files` 与 `koishi` 元信息应补齐
推荐至少包含：

```json
{
  "files": ["lib"],
  "koishi": {
    "description": {
      "zh": "...",
      "en": "..."
    }
  }
}
```

---

### 7.5 产物应与入口字段严格一致
宿主入口包最终应至少产出：

- `lib/index.cjs`
- `lib/index.mjs`
- `lib/index.d.ts`

并确保：

- `main` 指向 CJS
- `module` 指向 ESM
- `typings` 指向声明文件
- `exports` 与三者一致

---

## 八、内部能力包的正式要求

内部能力包当前应遵守：

### 8.1 使用当前 package.json 中声明的 scoped 名称
例如：
- `@elysia-ai/core`
- `@elysia-ai/behavior`
- `@elysia-ai/dialogue`

文档、测试和跨包 import 都应以 `package.json.name` 为准，不应根据目录名自行推导为 `@elysia-ai/core`、`@elysia-ai/behavior` 等不存在的包名。

### 8.2 重点是稳定导出
它们当前更重要的是：
- 类型
- 抽象
- schema
- 内部能力接口
- 工作区内部依赖关系

### 8.3 不直接承担 Koishi Loader 兼容责任
这些包不必伪装成宿主插件包。  
Loader 最终只应直接面对：
- `koishi-plugin-elysia-ai-runtime`
- `koishi-plugin-elysia-ai-body`

---

## 九、源码层要求

### 9.1 相对导入必须 Node ESM 兼容
例如：

```ts
import { createDefaultRuntime } from './runtime.js'
import { KoishiBodyAdapter } from './adapters/koishi/index.js'
```

---

### 9.2 测试文件必须排除出正式构建
`tsconfig` 中应显式排除：

- `src/**/*.test.ts`
- `src/**/__tests__/**`

---

### 9.3 NodeNext 规则必须被一致执行
源码层必须遵守统一规则，不应一部分按 NodeNext 写，一部分继续依赖模糊导入或目录解析。

---

## 十、构建策略建议

## 10.1 内部能力包
推荐：
- `tsc`

重点：
- 类型
- 导出边界
- workspace 内部消费

---

## 10.2 宿主入口包
推荐：
- `tsc --emitDeclarationOnly`
- `esbuild` 或 `tsup` 输出运行时产物

重点：
- 双入口产物
- 与 `exports` 对齐
- 宿主加载稳定

---

## 10.3 turbo 的角色
`turbo` 应继续只负责任务编排，例如：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["lib/**"]
    }
  }
}
```

它解决的是：

- 谁先 build
- 谁后 build
- 哪些产物缓存

它不直接决定插件包是否符合 Koishi 交付规范。

---

## 十一、workspace 组织要求

### 11.1 根 workspace 应覆盖两层包
对于当前结构，根 workspace 应覆盖：

```json
"workspaces": [
  "packages/*",
  "packages/@elysia-ai/*"
]
```

目的：
- 宿主入口包进入第一层工作区
- 内部能力包进入第二层工作区
- 保持工具链对工程边界的统一认知

---

### 11.2 必须建立“宿主入口包 / 内部库包”双模板
建议在工程规范层明确两套模板：

#### 宿主入口包模板
适用于：
- `elysia-ai-runtime`
- `elysia-ai-body`

#### 内部库包模板
适用于：
- `@elysia-ai/core`
- `@elysia-ai/shared`
- 以及其他内部能力包

这样能避免：
- package.json 风格混乱
- 构建规则混乱
- 发布边界混乱

---

## 十二、验证与验收

### 12.1 源码层验证
先验证：
- TypeScript 构建通过
- 相对导入合法
- 无测试文件混入产物
- `lib/` 产物生成

---

### 12.2 交付层验证
再验证：
- `lib/index.cjs`
- `lib/index.mjs`
- `lib/index.d.ts`

以及：
- `package.json` 的入口字段是否与产物一致

---

### 12.3 宿主验证
最后验证：
- Koishi 能找到包
- Loader 能成功加载
- 插件启动成功
- 不出现宿主兼容性错误

---

### 12.4 当前最终验收标准
宿主入口包只有在下面三项同时满足时，才算真正完成：

1. monorepo / TypeScript 构建通过
2. 交付产物完整且入口字段匹配
3. Koishi 宿主中实际加载成功

---

## 十三、当前插件装配顺序

当前主链 MVP 推荐按以下顺序装配插件：

1. `elysia-ai-runtime`
2. `elysia-ai-observatory`
3. `elysia-ai-model-gateway`
4. `elysia-ai-brain`
5. `elysia-ai-behavior`
6. `elysia-ai-dialogue`
7. `elysia-ai-body`

装配原因：

- `runtime` 提供 `eventBus` 与 `receiveStimulus()`
- `observatory` 依赖 runtime eventBus，应尽早加载以捕获后续主链事件，并挂载 `ctx['elysia-ai-observatory']`
- `model-gateway` 依赖 runtime eventBus，并挂载 `ctx['elysia-ai-model-gateway']`
- `brain` 依赖 runtime eventBus 与 model-gateway，并挂载 `ctx['elysia-ai-brain']`
- `behavior` 依赖 runtime eventBus，监听 `stimulus.received`
- `dialogue` 依赖 runtime eventBus 与 brain，监听 `behavior.instruction`
- `body` 依赖 runtime，负责 Koishi message 输入和 `dialogue.output.created` 输出发送

当前已验证的主链为：

```txt
Koishi message
  -> body PlatformMessage
  -> Stimulus
  -> runtime.receiveStimulus()
  -> stimulus.received
  -> behavior.instruction
  -> dialogue.task.created
  -> brain.requested
  -> gateway.requested
  -> dialogue.output.created
  -> sender.completed
  -> body.message.sent
  -> observatory trace by stimulusId
```

## 十四、当前最重要的整改方向

按当前状态，优先级应为：

1. **宿主入口包交付收口**
2. **workspace 范围标准化**
3. **双模板包规范**
4. **统一 build 策略**
5. **宿主集成测试**
6. **根仓库与包元信息补齐**

---

## 十五、经验附录：保留的历史试错信息

本节保留有价值但不应继续污染正文主线的试错经验。

### 15.1 为什么不能只看“单个 `lib/index.js`”
历史上曾采用过：

- `tsc`
- `type: module`
- `main: lib/index.js`
- NodeNext / `.js` 显式扩展名

这套方案说明了：
- 源码层 ESM 兼容是必要的
- 但它不足以保证 Koishi Loader 稳定加载

因此不能再把：
- “能产出一个 `lib/index.js`”
- “源码层能编译通过”

视为宿主接入完成。

---

### 15.2 为什么 `service-more` 能工作
`service-more` 的关键不只是 monorepo 结构，而是它通过：

- `postinstall`
- `scripts/patch-tsconfig.js`

自动向 Koishi 根 `tsconfig.json` 注入：

```txt
external/service-more/packages/*/src
```

这样根工作区才能把它内部的 `packages/*/src` 识别为插件源码目录。

---

### 15.3 `elysia-ai` 当前为什么也要 patch
`elysia-ai` 当前采用同样策略，在安装阶段注入：

```txt
external/elysia-ai/packages/*/src
```

这是因为 Koishi 根工作区不会自动理解任意嵌套 monorepo 的源码入口。  
这一步属于当前结构下的必要兼容措施。

---

### 15.4 经验保留方式
后续如果再出现类似“某方案试过但不推荐”的情况，建议写入附录，而不是回填到正文主线。

这样可以保证：
- 正文只表达“现在该怎么做”
- 附录解释“为什么我们这么做”

---

## 十六、一句话总结

这份文档的核心作用不是保存所有集成历史，而是：

> **明确 Elysia A.I. 在 Koishi 宿主中的当前正式集成要求，并解释为什么当前新结构比旧平铺结构更适合兼容 Koishi monorepo。**

## Phase 36 Update
- The minimal stable plugin set is now `runtime + observatory + model-gateway + brain + memory + bond + persona + perception + homeostasis + cognition + behavior + dialogue + body`.
- Dialogue should inject memory and bond context through the formal Koishi services when available.
- Legacy aliases are migration-only compatibility paths.
- New plugin development should register a formal service name first, then optionally mirror the legacy alias for one transition window.

## Phase 37 Update: Independent Plugin Installation
- Do not install Elysia as one central aggregate plugin.
- Install each required capability plugin explicitly in Koishi so configuration, lifecycle, hot reload, and dependency diagnostics remain visible.
- Minimal dialogue deployments should install `runtime`, `model-gateway`, `brain`, `behavior`, `dialogue`, and `body`.
- Full virtual-life deployments should add `observatory`, `memory`, `bond`, `persona`, `perception`, `homeostasis`, and `cognition`.

## Phase 39 plugin boundary

- Official Koishi plugin entries live in top-level `packages/elysia-ai-*` packages.
- Internal implementation packages live in `packages/@elysia-ai/*` and expose `internalName` / `applyInternal` instead of official `name` / `apply`.
- Minimal dialogue chain: `koishi-plugin-elysia-ai-runtime` + `koishi-plugin-elysia-ai-model-gateway` + `koishi-plugin-elysia-ai-brain` + `koishi-plugin-elysia-ai-behavior` + `koishi-plugin-elysia-ai-dialogue` + `koishi-plugin-elysia-ai-body`.
- Full life chain adds `memory`, `bond`, `persona`, `perception`, `cognition`, `homeostasis`, and `observatory` top-level plugins.
- Debug observability chain: `runtime` + `observatory` + `model-gateway` + `brain` + `dialogue`.

## Phase 40 packaging rule

- Install and load only top-level `koishi-plugin-elysia-ai-*` packages in Koishi.
- Do not load `@elysia-ai/*` packages directly; they are implementation libraries used by the top-level plugins.
- Custom integrations should depend on canonical `elysia.*` services or internal factories deliberately, not on hidden Koishi entrypoints.
## Phase 42 Recommended Plugin Compositions

Elysia A.I. is delivered as multiple Koishi plugins. Do not install a central aggregator plugin; install the capability plugins that match the desired runtime shape.

### Minimal Dialogue Chain

Install in this order:
1. `koishi-plugin-elysia-ai-runtime`
2. `koishi-plugin-elysia-ai-model-gateway`
3. `koishi-plugin-elysia-ai-brain`
4. `koishi-plugin-elysia-ai-behavior`
5. `koishi-plugin-elysia-ai-dialogue`
6. `koishi-plugin-elysia-ai-body`

This chain supports message ingestion, model execution, brain response composition, behavior dispatch, dialogue execution, and Koishi outbound routing. Memory and bond context are skipped when their plugins are absent.

### Full Life Chain

Install in this order:
1. `koishi-plugin-elysia-ai-runtime`
2. `koishi-plugin-elysia-ai-observatory`
3. `koishi-plugin-elysia-ai-model-gateway`
4. `koishi-plugin-elysia-ai-brain`
5. `koishi-plugin-elysia-ai-memory`
6. `koishi-plugin-elysia-ai-bond`
7. `koishi-plugin-elysia-ai-persona`
8. `koishi-plugin-elysia-ai-perception`
9. `koishi-plugin-elysia-ai-homeostasis`
10. `koishi-plugin-elysia-ai-cognition`
11. `koishi-plugin-elysia-ai-behavior`
12. `koishi-plugin-elysia-ai-dialogue`
13. `koishi-plugin-elysia-ai-body`

This chain enables memory updates, relationship updates, persona context, perception/cognition routing, homeostasis side effects, observability, and the full reply path.

### Debug Observability Chain

Install in this order:
1. `koishi-plugin-elysia-ai-runtime`
2. `koishi-plugin-elysia-ai-observatory`
3. `koishi-plugin-elysia-ai-model-gateway`
4. `koishi-plugin-elysia-ai-brain`
5. `koishi-plugin-elysia-ai-dialogue`

This chain is suitable for inspecting runtime events, model gateway analytics, prompt composition, and dialogue execution without enabling the full life-system side effects.

Dependency behavior:
- Required services fail fast and prevent half-initialized plugins.
- Optional services degrade explicitly: dialogue works without memory/bond, and perception/cognition can run without brain-enhanced analysis where configured.
- Dispose must remove each plugin's canonical service and legacy alias without clearing unrelated plugin services.
## Phase 43 Local And Production Configuration Examples

### Local Development Defaults

Use the same plugin composition as Phase 42. Omit repository provider config for `memory` and `bond`; they use in-memory repositories and require no external database.

```yaml
plugins:
  koishi-plugin-elysia-ai-runtime: {}
  koishi-plugin-elysia-ai-model-gateway:
    slots: {}
  koishi-plugin-elysia-ai-brain: {}
  koishi-plugin-elysia-ai-memory:
    enabled: true
    contextLimit: 5
  koishi-plugin-elysia-ai-bond:
    enabled: true
    contextLimit: 5
  koishi-plugin-elysia-ai-dialogue:
    enabled: true
  koishi-plugin-elysia-ai-body: {}
```

### Production Provider Registry

Prefer `providers` + `providerSlots` for model-gateway. Keep API keys in environment variables.

```yaml
plugins:
  koishi-plugin-elysia-ai-model-gateway:
    providers:
      primary-openai:
        type: openai
        model: gpt-4.1-mini
        apiKeyEnv: OPENAI_API_KEY
      backup-claude:
        type: claude
        model: claude-3-5-sonnet
        apiKeyEnv: CLAUDE_API_KEY
    providerSlots:
      chat:
        provider: primary-openai
      fallback-chat:
        provider: backup-claude
    defaultSlot: chat
    fallback:
      enabled: true
      slots:
        chat: [fallback-chat]
```

### Production Repository Injection

`memory` and `bond` expose `repository.type = mongo` as a fail-fast production mode. The actual Mongo-compatible repository factory is injected by code at the top-level plugin boundary, not by runtime and not by internal packages.

Rules:
- If `repository.type` is omitted, the plugin uses the in-memory repository.
- If `repository.type = mongo` and no `repositoryFactory` is injected, plugin apply throws before service registration.
- Repository initialization emits diagnostics that observatory can query by `component` and `repositoryType`.
## Phase 44 Production Readiness Examples

### Mongo Repository Factory Wiring

`memory` and `bond` production repositories are code-injected factories. They are not runtime config and do not require the internal packages to import Koishi or a Mongo SDK.

```ts
import { createMongoMemoryRepositoryFactory } from 'koishi-plugin-elysia-ai-memory'
import { createMongoBondRepositoryFactory } from 'koishi-plugin-elysia-ai-bond'

ctx.plugin(memoryPlugin, {
  enabled: true,
  contextLimit: 8,
  repository: { type: 'mongo', mongo: { collectionName: 'elysia_memories' } },
  repositoryFactory: createMongoMemoryRepositoryFactory(memoryCollection, {
    collectionName: 'elysia_memories',
  }),
})

ctx.plugin(bondPlugin, {
  enabled: true,
  contextLimit: 8,
  repository: { type: 'mongo', mongo: { collectionName: 'elysia_bonds' } },
  repositoryFactory: createMongoBondRepositoryFactory(bondCollection, {
    collectionName: 'elysia_bonds',
  }),
})
```

The external Mongo client and collection lifecycle remains owned by the host application. Plugin dispose does not close the external client.

### Gateway Validation And Secret Hygiene

`model-gateway` validates production provider config before service registration. Errors mention provider ids, provider types, model names, and env var names, but never inline API key values.

```yaml
koishi-plugin-elysia-ai-model-gateway:
  providers:
    primary:
      type: openai
      model: gpt-4.1-mini
      apiKeyEnv: OPENAI_API_KEY
  providerSlots:
    chat:
      provider: primary
  fallback:
    enabled: true
    slots:
      chat: [backup]
```

### Repository Analytics

`observatory` snapshots now include `repositoryAnalytics`, derived from `repository.initialized`, `repository.fallback-to-memory`, `repository.query.failed`, and `repository.write.failed` events. Use it to confirm whether memory/bond are running on in-memory or Mongo-compatible repositories and whether repository errors are increasing.

## Phase 45 Operational Commands And Preflight

Phase 45 adds a lightweight operator surface through the top-level `koishi-plugin-elysia-ai-observatory` plugin. It does not add a web dashboard and does not change Koishi root loading.

Recommended commands after loading runtime and observatory:

- `elysia.status`: lists canonical `elysia.*` services, loaded state, readiness, and recent failure count.
- `elysia.gateway.status`: summarizes provider registry and health snapshots without API keys.
- `elysia.repository.status`: summarizes memory/bond repository initialization, fallback, query failure, and write failure counters.
- `elysia.preflight`: formats structured preflight results when config preflight callbacks are provided; with no payload it returns a warning instead of registering services.

Static production checks should use exported helpers before plugin loading:

- `preflightModelGatewayConfig(config)` from `koishi-plugin-elysia-ai-model-gateway`.
- `preflightMemoryConfig(config)` from `koishi-plugin-elysia-ai-memory`.
- `preflightBondConfig(config)` from `koishi-plugin-elysia-ai-bond`.
- `runElysiaPreflight(configs)` from `koishi-plugin-elysia-ai-observatory` for combining independent plugin checks.

Operational output is intentionally sanitized. It may include provider id/type/model, repository component/type, error code, counters, and timestamps. It must not include API keys, authorization tokens, full prompts, or full user messages.

Dynamic configuration boundary for Phase 45:

- Provider API keys, provider definitions, repository factories, and Mongo collection ownership still require restart/re-apply.
- Observatory retention and command formatting are safe operator surfaces, but not a hot-reload system.
- Future phases may add provider slot reload, repository migration helpers, and console/dashboard UI.

