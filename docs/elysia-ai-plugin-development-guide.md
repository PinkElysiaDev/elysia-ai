# Elysia A.I. 插件开发指南

> 本文是 step-by-step 开发教程。边界与命名规则见《插件开发规范》
> （`elysia-ai-plugin-development-spec.md`）；事件载荷明细见
> 《事件目录》（`elysia-ai-events-reference.md`）；可运行的完整参考实现见
> `examples/elysia-plugin-emotion`。

## 0. 框架心智模型

Elysia A.I. 是 Koishi 之上的领域框架，核心是 **kernel 通用子框架**
（`@elysia-ai/kernel`，零依赖、宿主无关，可脱离 AI 领域单独复用）：

```
Koishi/cordis         宿主底座：平台适配、插件装载、配置面板
  └ kernel            通用框架：阶段管线 / 请求上下文 / 类型化事件 /
      │               生命周期 / manifest 兼容治理 / trace / 测试 harness
      └ core          AI 领域契约：Life/Habitat/Stimulus/Memory + 阶段表
          └ 13 官方插件 + 你的第三方插件
```

**阶段与事件分工模型**（最重要的一个概念）：

| 轨道 | 语义 | 机制 | 谁用 |
|---|---|---|---|
| 阶段（stage） | 处理步骤（命令侧） | `pipeline.registerHook({ stage, priority, run })`，kernel 拓扑排序调度 | 要参与主链处理的模块（单轨装配；2026-10 起不再保留事件兜底路径） |
| 事件（event） | 已发生的事实（通知侧） | `eventBus.emit/on`，监听者错误隔离 | 观测者、旁路消费者 |

阶段顺序由 `before/after` DAG 声明决定，**与插件加载顺序无关**——这是
相对裸 Koishi（广播-监听、顺序靠加载序）的核心改进。

## 1. 领域管线阶段表（core 声明，第三方可扩展）

```
刺激段（每 stimulus 一次）：
  stimulus.received → perception → [第三方阶段...]

生命段（每个路由命中的 lifeId 一次，上下文以刺激段为父链）：
  cognition → behavior.decide → behavior.execute → dialogue → [第三方阶段...]
```

第三方插入新阶段用 `before/after`（示例：emotion 插在 perception 与
cognition 之间）：

```ts
pipeline.registerStage({ name: 'emotion', after: ['perception'], before: ['cognition'] })
pipeline.registerHook({ stage: 'emotion', owner: 'elysia-plugin-emotion', async run(pctx) { ... } })
```

**分界锚点 = `cognition`**：runtime 以 cognition 为界动态切分两段——
锚点之前（含 perception 等）为刺激段，每 stimulus 执行一次；锚点起
（cognition → … → sender）为生命段，每个路由命中的 lifeId 执行一次。
第三方阶段按其拓扑位置**自动归段**（perception 后/cognition 前 → 刺激段
一次；dialogue 后 → 生命段每生命一次）。注意：想把每刺激一次的逻辑放在
生命信息可用之前，就声明在 cognition 之前。

钩子内可 `pctx.stop(reason)` 终止后续阶段（如低显著性丢弃）。

## 2. 五分钟起步：脚手架

```bash
cd external/elysia-ai
node scripts/scaffold-package.mjs elysia-plugin-mood --service elysia.mood --stage perception
cd ../.. && yarn install
npx vitest run mood
```

生成 `examples/elysia-plugin-mood/`：package.json（双格式 exports +
`koishi.service.implements`）、tsconfig、工厂 v2 骨架（inject + Config +
manifest + 阶段钩子）、createHarness 测试模板。

## 3. 插件结构（两层拆分）

与官方插件一致：

```
库层 wireXxx()   宿主无关：kernel 原语 + 事件总线；createHarness 直接测试
Koishi 壳 apply   工厂 v2：inject / Config Schema / manifest / 服务注册
```

壳层完整骨架（emotion 示例节选）：

```ts
export const name = 'elysia-plugin-emotion'
export const inject = ['elysia.runtime']          // cordis 等 runtime 就绪再 apply

export const Config: Schema<Config> = Schema.object({ ... })

export const apply = createElysiaPlugin<Config,
  { context: { eventBus: EventBus<CoreEventMap>, pipeline: PipelineRunner<unknown> } },
  EmotionService
>({
  name: 'elysia-plugin-emotion',
  serviceFormalName: 'elysia.emotion',
  manifest: {                                       // 兼容治理（见 §6）
    name: 'elysia-plugin-emotion', version: '0.1.0',
    services: { provides: ['elysia.emotion'], consumes: ['elysia.runtime'] },
    stages: { hooks: ['emotion'] },
    configNamespace: 'emotion',
  },
  build({ runtime, config, logger }) {
    const handle = wireEmotion({ ...runtime.context, config, logger })
    if (!handle) return undefined                   // 返回 undefined = 放弃注册
    return { service: handle.service, dispose: () => handle.dispose() }
  },
})
```

依赖声明三级：
- **必需**：`export const inject = [...]`（cordis 等待）；
- **可选**：`getOptionalElysiaService(ctx, { formalName })` 降级；
- **manifest**：`dependencies`/`services.consumes`，启动时告警式校验。

## 4. 共享上下文（取代私搭缓存）

一次处理内，上游写入命名空间、下游直接读，不再各自维护 BoundedCache：

```ts
// 写（自己的命名空间）
pctx.write('emotion', { mood: 0.6 })
// 读（任意命名空间；生命段上下文自动回溯刺激段父链）
const perception = pctx.read<PerceptionResult>('perception')
// 便捷视图
const view = pctx.forNamespace('emotion'); view.get(); view.set(...)
```

官方命名空间常量：`NS_PERCEPTION` / `NS_BEHAVIOR` /
`NS_DIALOGUE`（`@elysia-ai/core`）。上下文随管线结束自动清理。

## 5. 类型化扩展事件（不改 core 发版）

`CoreEventMap` 是 interface，直接声明合并：

```ts
declare module '@elysia-ai/core' {
  interface CoreEventMap {
    'emotion.evaluated': { stimulusId: string, mood: number }
  }
}
// 此后 emit/on 的键与载荷都有编译期约束：
await eventBus.emit('emotion.evaluated', { stimulusId, mood })
```

观测类消费者可用通配符 `eventBus.onAny((event, payload) => ...)`，
不必枚举事件名（observatory 已如此重构）。

## 6. manifest 兼容治理

工厂 v2 的 `manifest` 字段注册到 runtime 的注册表，`runtime.start()` 统一
校验（**告警不阻断**）：依赖存在性（missing-dependency/error）、
frameworkApiVersion 兼容（warn）、未知服务/阶段引用（warn）、
configNamespace 冲突（error）。可在日志中按 `phase: 'manifest-validate'`
过滤。

## 7. 每生命体配置（manifest.json extensions）

用户在 `manifest.json` 的 `lifeInstances[].extensions['<你的 configNamespace>']`
写你的私有配置；插件订阅 `life.loaded` 事实事件读取：

```ts
eventBus.on('life.loaded', ({ lifeId, config }) => {
  const own = (config as { extensions?: Record<string, unknown> }).extensions?.['emotion']
})
```

## 8. 测试（createHarness，无需 Koishi app）

```ts
import { ELYSIA_PIPELINE_STAGES, createHarness } from '@elysia-ai/core'

const harness = createHarness<CoreEventMap>()
for (const stage of ELYSIA_PIPELINE_STAGES) harness.runner.registerStage(stage)
const handle = wireMood({ pipeline: harness.runner, eventBus: harness.bus, config: {} })

await harness.runPipeline({ id: 's1', core: { stimulus: {...} } })  // 驱动管线
expect(harness.runner.getStageOrder().indexOf('mood')).toBeGreaterThan(0)
```

harness 提供 bus/runner/contexts/lifecycle/manifests 全套内存实现。

## 9. 发布

- 命名 `elysia-plugin-<name>`（或带组织前缀的 scoped 包）；
- `package.json` 带 `koishi.service.implements` 与双格式 exports
  （脚手架已生成）；
- 从 monorepo 发布见根 readme 的 yakumo/turbo 构建说明；
- 依赖版本：`@elysia-ai/core`（含 kernel re-export）+ 按需 `shared`。

## 10. 检查清单

- [ ] 库层/Koishi 壳两层拆分，库层无 cordis 依赖
- [ ] 阶段用 before/after 声明位置（不依赖加载顺序）
- [ ] 上下文只写自己命名空间，读上游用 NS_* 常量
- [ ] 扩展事件用声明合并 + 类型化载荷
- [ ] manifest 完整（services/stages/configNamespace）
- [ ] 有 createHarness 测试
- [ ] 日志带 `{ plugin, phase }` 结构化字段
