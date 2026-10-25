# elysia-ai 数据库表结构设计（通俗版）

> 一句话定位：**数据库是整个框架的"硬盘"——存的是重启之后也不能丢的东西**：生命体此刻的状态数值、长期记忆、跟每个用户的关系、定时任务、路由规则。elysia-ai 一共只有 5 张"表"，全部存在 MongoDB 里。2026-10-11 完成了一轮字段去重优化：**去掉了全部"外层骨架"字段和死字段，现在每张表的一行就是数据本身**（详见 §1.1 的优化说明）。要注意：**你现在的配置一张表都没建**（数据全在内存草稿纸上，重启即丢，详见 §10 怎么开启）。这篇文档把 5 张表逐字段讲清楚，遇到基础概念随时用大白话解释。

---

## 0. 预备知识：读这篇文档需要的最少概念

### 0.1 MongoDB 的三层结构，对照 Excel 来理解

| MongoDB 术语 | Excel 里对应的东西 | 在本项目里 |
|---|---|---|
| 数据库（database） | 整个 Excel 文件 | `elysia_ai`（一个文件） |
| 集合（collection） | 文件里的一张工作表 | 5 张表：life_states、elysia_projection_rules、elysia_memories、elysia_bonds、elysia_trigger_tasks |
| 文档（document） | 工作表里的**一行**记录 | 比如一条记忆、一个定时任务 |

和 Excel 有一点不同：**MongoDB 的一行里可以再塞一小块嵌套结构**。比如记忆表的一行，除 id、时间这些栏目外，正文内容、标签、来源可以分组嵌着放。可以把一行想象成一张卡片，卡片上直接写着分组的栏目。

### 0.2 "每个 A × B 一条文档"里的 × 是什么意思

× 读作"乘"，在这里表示**组合**。"每个 life × stateType 一条文档" = **每（一个生命体，一种状态类别）的组合占一行**。

拿成绩单打比方："每个学生 × 每个科目一条记录"——张三的数学一行、张三的语文又一行、李四的数学再一行。两个学生两个科目就是 2×2=4 行。

### 0.3 术语速查表

| 术语 | 大白话解释 |
|---|---|
| 字段 / 类型 | 一行里的一个栏目（如 `name`）；类型 = 格子里放什么形态的东西：`string` 文字、`number` 数字、`boolean` 真假、`string[]` 文字列表、嵌套对象 一小袋成组的栏目 |
| epoch ms 时间戳 | 计算机记时间的通用方式：数"从 1970-01-01 到现在过去了多少毫秒"，所以是一串大数字，如 `1791000000000` ≈ 2026 年 10 月。好处是数字之间可以直接比大小、做减法算间隔 |
| 索引 | 像书的目录、字典的部首检字表：不用从第一页翻到最后一页，直接定位到要找的那几行。代价是每加一个目录，每次写入都要多维护一份 |
| 唯一索引 | 加了"不许重复"限制的目录——像身份证号，两行不许撞号。用来防止同一东西存两份 |
| upsert | "有就更新，没有就新建"（update + insert 两个词的合成）。保存时不用先查一遍存不存在，一句指令搞定 |
| 软删除 / 硬删除 | 软删除 = 丢进回收站（打个 `deleted` 标记，数据还在，可追溯）；硬删除 = 直接碎纸（这行没了就真没了） |
| 内存（memory） / 持久化 | 内存 = 草稿纸，程序一重启字迹全消失；持久化（落库）= 存进文件，重启还在 |
| `$inc` 原子自增 | 让数据库服务器直接在你的数字上 +1。类比：银行柜台直接在你账户上加分，而不是你自己算好再报给柜台——两个人同时改同一个数字也不会算丢 |
| 查询下推 | 让数据库服务器在它的地盘帮你把符合条件的数据**先筛出来**再发给你，而不是把整个仓库搬回家自己挑 |
| 判别联合 | 一个字段先看 `type` 写的是什么，再决定后面跟哪些栏目——像快递单先勾"文件 / 物品"，勾完不同种类出现的下一栏不一样 |
| BoundedCache / 环形缓冲 | 一本**页数固定**的笔记本：写满了就自动擦掉最旧的一页接着写，所以最多只有那么多条 |

---

## 1. 全局设计约定（5 张表共用的套路）

### 1.1 一行 = 数据本身（2026-10-11 优化后）

以前每张表的一行长这样：`{ 外层id, 信封(真正的内容), 外层创建时间, 外层修改时间 }`——外层那三样是仓储层的"登记章"，和信封内容里的 id、时间是**重复的**，而且业务代码一个都不读。2026-10-11 的优化把它们全删了，现在：

- **记忆 / 关系 / 任务 / 路由规则四张表**：一行就是 `{ entry/bond/task/rule: 领域对象本身 }`，文档的"身份证号"用**信封里的 id**（如 `entry.id`）充当——查询键和唯一索引都走这个点路径。
- **状态表**（本来就是特殊形态）：一行就是 `{ lifeInstanceId, stateType, state }`，时间只看信封里的 `state.timestamp`。
- 同时删掉的**死字段**：状态信封里和外层重复的 `lifeInstanceId`；关系表顶层三个旧数值镜像（familiarity/intimacy/trust）和旧的 `lifeInstanceId`；关系表 targetType 的三个旧别名（individual/collective/channel）。

### 1.2 其余约定

| 约定 | 大白话解释 |
|---|---|
| 不用 Koishi 自带的表格系统 | Koishi 框架本来有一套建表工具（`ctx.model.extend`），本项目完全没用（全仓 0 处），直接读写 MongoDB |
| 驱动按需加载 | 程序不会强制依赖 MongoDB 的驱动包，运行到要用时才动态加载。没装驱动、连不上库都不会崩——自动退回"草稿纸"模式 |
| 时间全用大数字 | 所有时间字段都是 epoch 毫秒数（见 §0.3）。**唯一例外**：定时任务里用户/LLM 填的时刻（`at`/`anchorAt`）保留 `"2026-10-09T09:00:00"` 这种文字原样存储 |
| 写入统一 upsert | 改任何一行都是"有就更新（整体替换信封），没有就新建"，不用分两步；时间戳由领域对象自带，仓储层不再额外维护 |
| ID 自己拼 | 各插件自己拼 ID：`前缀-时间戳-序号`，例如 `memory-1791000000000-7`。没有公共的统一发号器 |

**删除策略不统一（有意为之）**：记忆和关系用软删除（回收站，历史可追溯）；定时任务和路由规则用硬删除（碎纸，反正能照着配置重建）。

**共用底座 MongoDocRepository**（`@elysia-ai/shared/src/mongo-doc-repository.ts`）：4 张表的存取器都基于同一个基座组合而成，文档键统一走 `${信封}.id` 点路径，提供"存一行 / 按 id 取一行 / 按条件取多行 / 数数 / 数字加一（$inc）/ 条件更新（CAS，见 §7.5）/ 删一行 / 建目录"这些基础动作——写一遍，四张表共用。

---

## 2. 持久化拓扑：总开关在哪，怎么降级

```
elysia-ai-runtime 插件的配置项 stateRepository（总开关）
   ├─ 'memory'（默认）──────► 全部数据只写草稿纸（内存），重启全丢，一张表都不建
   └─ 'mongo' ── 连接 MongoDB ──┬─ 连接失败 ──► 默认悄悄退回草稿模式（打一条警告日志）
                               │              （除非 failFast: true 才让它报错停下）
                               ▼
                  持久化服务 elysia.persistence（总前台）
                               │ 问它要某张表的句柄（getCollection）
             ┌─────────┬───────┴──────┬─────────────┐
             ▼         ▼              ▼             ▼
        life_states  投影规则表     记忆表         关系表
       （runtime自用） （runtime）  （memory插件）  （bond插件）
                                          定时任务表（behavior插件）
             └─────────┴──────┬───────────┴─────────────┘
                              ▼
              拿不到句柄（没连库）→ 各自用进程内的 Map（草稿纸版）顶上
```

runtime 插件的存储相关配置（在 koishi 控制台 / koishi.yml 里填）：

| 配置项 | 可选值 | 默认 | 大白话 |
|---|---|---|---|
| manifestPath | 文件路径 | 无 | 生命体清单 JSON 的位置（这是文件持久化，不是数据库） |
| stateRepository | memory / mongo | **memory** | 总开关：要不要把数据落盘 |
| uri | 连接串（密码性质） | —（选 mongo 必填） | MongoDB 的地址，如 `mongodb://localhost:27017` |
| database | 名字 | `elysia_ai` | 数据库文件叫什么名 |
| collection | 名字 | `life_states` | 状态表叫什么名（一般不用改） |
| stateType | 名字 | `homeostasis` | 状态类别标签（见 §3，一般不用改） |
| failFast | 真假 | false | 连库失败时要不要直接报错停掉插件（默认宽容：退回草稿模式） |

**要点**：`getCollection` 拿不到句柄就返回"没有"，记忆 / 关系 / 定时任务三个插件看到"没有"，就各自用内存版仓储顶上。连接的打开和关闭都归 runtime 管，其他插件只借不还（不用管生命周期）。

---

## 3. life_states —— 生命体的"游戏存档"（状态数值表）

**这张表是干嘛的**：存每个生命体**此刻的四个内部数值**——精力、心情、社交意愿、好奇心（都在 0~1 之间）。就像游戏存档里的血条蓝条：0.7 表示七成满。生命体每次被消息"碰到"都会微调这些数值，朝静息基线慢慢回落；重启后从这里恢复，人设才不会"一觉醒来失忆变脸"。

### 3.1 一行长什么样（示例）

```js
{
  lifeInstanceId: "roza",              // 哪个生命体（manifest 里的 id）
  stateType: "homeostasis",            // 状态类别标签（目前全库只有这一种）
  state: {                             // ▼ 信封：真正的内容（也是唯一的栏目组）
    timestamp: 1791000000000,          //   这份状态是什么时候算出来的（≈2026-10）
    energy: 0.62,                      //   精力：还剩六成
    mood: 0.55,                        //   心情
    sociability: 0.7,                  //   社交意愿
    curiosity: 0.4,                    //   好奇心
    metadata: { }                      //   备用空抽屉，目前没用
  }
}
```

### 3.2 "每个 life × stateType 一条文档"到底是什么形状

按 §0.2 的解释：**每（个生命体，种状态类别）的组合占一行**。目前 stateType 只有 `homeostasis` 一种值，所以实际上**每个生命体恰好一行**——两个生命体就是两行。那为什么还留 stateType 这个字段？给未来扩展用：哪天想存别的类别状态（比如按月汇总的统计），不用改表结构，换一个标签就能再来一行，和现有的互不干扰。

为什么一行里没有"创建时间/修改时间"了？因为它们以前是外层登记章、没人读；这份状态**唯一需要的时间**是"状态本身是什么时候算出来的"（`state.timestamp`），它有真实用途：behavior 的快照缓存靠它做乱序保护——旧事件晚到时比较时间戳，旧的直接丢弃，防止状态"倒退"。

### 3.3 字段说明

| 字段 | 类型 | 大白话 |
|---|---|---|
| lifeInstanceId | string | 归属哪个生命体（和外层文档键同一个东西，这就是它的家） |
| stateType | string | 状态类别标签，默认 homeostasis |
| state.timestamp | number | 这份状态算出来的时刻（epoch ms） |
| state.energy / mood / sociability / curiosity | number | 精力 / 心情 / 社交意愿 / 好奇心，各 0~1 |
| state.metadata | 嵌套对象（可空） | 备用抽屉（最近一次更新的请求 ID 等会写在这里） |

### 3.4 索引与读写

- 唯一索引：`{ lifeInstanceId, stateType }`，名 `life_state_identity_unique`——保证"同一个生命体的同一类状态"只有一行，想存第二行会被数据库拒绝（upsert 变成更新原行）。
- 写：每次数值变化就整行覆盖保存（upsert）。读：生命体启动加载时按 `lifeInstanceId` 取一次。没有历史版本——只留"最新一档"，不存变化过程。

---

## 4. elysia_projection_rules —— 路由规则表（哪些消息给哪个生命体处理）

**这张表是干嘛的**：存"哪个平台 / 哪个群 / 哪个频道的消息，要交给哪个生命体处理"的对应规则。manifest.json 里写的投影规则，启动时会被复制进这张表；反过来，就算你不配 manifest，这张表里已有的规则也会在启动时被捞起来生效——两边互相兜底。

### 4.1 一行长什么样（示例）

```js
{
  rule: {                             // ▼ 一行就是规则本身
    id: "onebot-group-digitallife",
    lifeId: "roza",                   //   命中后交给 roza 处理
    enabled: true,                    //   开关（见 4.2 的三态说明）
    priority: 10,                     //   多条规则都命中时，数字大的排在前面先处理
    platform: "onebot",               //   只匹配 onebot 平台（留空 = 不限）
    habitatId: "517086112",           //   只匹配这个 QQ 群（留空 = 不限）
    channelId: undefined,             //   频道限定（这里没用）
    threadId: undefined,              //   话题线程限定
    actorId: undefined,               //   只看某个用户的消息
    botId: undefined,                 //   只看某个机器人账号收到的
    metadata: { }
  }
}
```

### 4.2 字段说明

信封内字段就是一排"筛选条件"，**填了的条件必须全部满足（AND），留空表示不限**。特别说一个容易踩的点：

**`enabled` 是三态的**：填 `true` = 开；填 `false` = 关；**什么都不填 = 默认开**。所以"找出所有开启的规则"用的查询条件是"enabled 不等于 false"——什么都不填的也能被捞出来。

这张表**没有任何时间字段**——规则是配置性质的数据（manifest 随时可以重写它），不需要记录"什么时候写的"。

### 4.3 索引（3 个）与启动恢复

| 键 | 唯一 | 实际索引名 | 为什么 |
|---|---|---|---|
| { rule.id } | 是 | `elysia_projection_rules_id_unique` | 规则身份证，不许重复（文档键就是它） |
| { rule.lifeId } | 否 | `elysia_projection_rules_life` | 常按"某生命体的规则"查 |
| { rule.enabled } | 否 | `elysia_projection_rules_enabled` | 启动时捞"所有开启的规则"很快 |

**启动恢复流程**：启动 → 把开启的规则全部捞出、逐条登记进内存 → 然后如果配了 manifest，manifest 里的规则再覆盖写入一遍（幂等：重复执行结果一样）。这修的是一个历史 bug（P0-3）：以前不配 manifest 时会退化成"所有生命体感知所有消息"的宽路由。删除规则是硬删（这行直接没了）。

---

## 5. elysia_memories —— 长期记忆表（最大最复杂的一张）

**这张表是干嘛的**：生命体的长期记忆本。谁说过什么、发生过什么事、生命体学到过什么，都被提炼成一条条"记忆"存进来；每次被唤醒时，挑几条最相关的塞进 prompt（" Relevant long-term memories"那段）。它有容量上限（每生命体默认 100 条活跃记忆，`maxEntriesPerLife` 可配），满了会把不重要的挤去归档。

### 5.1 一行长什么样（示例）

```js
{
  entry: {                             // ▼ 一行就是记忆本身
    id: "memory-1791000000000-7",      //   自动拼的 ID（也是这行的文档键）
    lifeId: "roza",                    //   roza 的记忆（生命体之间互不可见）
    scope: "actor",                    //   归属层级：这是关于某个用户的（见 5.3）
    kind: "preference",                //   记忆种类：偏好（见 5.3）
    status: "active",                  //   在用（不是归档/回收站）
    content: "小明不喜欢别人剧透动漫",   //   记忆正文
    summary: "小明的剧透禁忌",          //   摘要（可空）
    tags: ["偏好", "动漫"],            //   标签
    actorId: "12345",                  //   关于用户 12345（"在场的人"）
    ownerType: "actor",                //   归属者类型+ID：这条记忆"归谁保管"
    ownerId: "12345",                  //   （自动推断，见 5.3 的两者区别）
    relations: [                       //   关联三元组：这条记忆还牵扯到谁/什么
      { targetType: "actor", targetId: "12345", role: "subject" }
    ],
    visibility: "habitat",             //   可见范围：同群共享（见 5.3）
    source: { stimulusId: "stim-abc" },//   从哪条消息提炼出来的（溯源）
    importance: 0.8,                   //   重要性 0~1（挑记忆时占大头权重）
    confidence: 0.7,                   //   置信度 0~1
    createdAt: 1791000000000,          //   这条记忆诞生的时间（排序/打分都靠它）
    updatedAt: 1791000500000,          //   最后修改时间
    lastAccessedAt: 1791000500000,     //   上次被"想起来"的时间
    accessCount: 3,                    //   被想起来过 3 次（数据库自动 +1）
    metadata: { attributionMode: "deterministic" }
  }
}
```

### 5.2 字段说明（重点枚举逐个解释）

**kind——这条记忆是什么性质**：

| 值 | 大白话 |
|---|---|
| episodic | 情节记忆："那天群里聊过 X"（发生过的事） |
| semantic | 事实记忆："他住在上海"（学到的事实） |
| preference | 偏好："他不喜欢剧透" |
| relationship | 关系认知："他和小李是室友" |
| self | 自我认知：生命体对自己的认识 |
| task | 待办："答应了明天发图" |
| system | 系统内部记的事 |

**status——这条记忆现在什么状态**：`active` 在用 / `archived` 归档（容量满时被挤到箱底，或合并整理时收起来）/ `suppressed` 压制 / `deleted` 回收站（软删除，都不物理删）。

**visibility——谁能"想起来"**：`private` 只有这个生命体自己 / `shared` 同一话题线程内共享（不外漏）/ `habitat` 同一群·频道共享 / `global` 全局。

**scope——归属到哪一层**：`life` 整个生命体 / `actor` 某个用户 / `habitat` 某个群 / `thread` 某个话题 / `projection` 某条投影 / `global` 全局。

`relations` 是"这条记忆还牵扯谁"的列表，每条记三个要点：牵扯的对象类型 + 对象 ID + 角色（subject 主角 / participant 参与者 / mentioned 被提到 / observer 旁观 / location 地点 / source 出处 / shared-with 共享对象）。

### 5.3 actorId 和 ownerId 不是一回事（都要保留）

- **actorId** = "这条记忆发生时**在场的那个用户**"（原始关联维度，从消息直接抄来）。
- **ownerType + ownerId** = "这条记忆**归谁保管**"——由归因器按推断链（显式指定 > 全局 > 事件 > 话题 > **群** > 用户 > 投影 > 生命）自动选出的主归属。

因为记忆请求恒带群 ID，**普通群聊和私聊的记忆实际都归"群"档**（ownerId = 群号/私聊频道号），只有回复消息才归"话题"档；两者只在纯用户归档时相同。用途也不同：owner 参与检索打分，actorId 参与可见性判断和去重合并——不是重复字段。

### 5.4 索引（6 个）——每个都是为了某个查询不翻全表

| 键 | 唯一 | 实际索引名 | 为什么 |
|---|---|---|---|
| { entry.id } | 是 | `elysia_memories_id_unique` | 记忆身份证（也是文档键） |
| { entry.lifeId, entry.createdAt ↓ } | 否 | `elysia_memories_life_created` | 默认按时间列记忆 |
| { entry.source.stimulusId } | 否 | `elysia_memories_stimulus` | 同一条消息重复触发时查重 |
| { entry.lifeId, entry.status, entry.ownerType, entry.ownerId, entry.createdAt ↓ } | 否 | `elysia_memories_life_status_owner` | 挑记忆时按"归属者"等值筛查 |
| { entry.lifeId, entry.status, entry.importance ↓ } | 否 | `elysia_memories_life_importance` | 按重要性排；容量满时淘汰最不重要的也用它 |
| { entry.relations.targetType, entry.relations.targetId } | 否 | `elysia_memories_relations` | 按"牵扯到某人"找记忆 |

### 5.5 查询的"分工"：哪些条件数据库帮筛，哪些搬回家自己挑

- **数据库帮筛（下推）**：生命体、状态、种类、可见性这些"选项式"条件，以及时间/重要性的大小比较，还有"牵扯到某人"。
- **搬回家自己挑**：**按关键词找正文**（content/summary/tags 里搜子串）和标签全匹配——数据库筛不了这两种，就**多取 3 倍的数据量**回来在内存里慢慢挑（所以叫"3 倍放大窗口"）。
- `accessCount` 的 +1 用 `$inc`：数据库原子操作，两个人同时"想起"同一条记忆也不会把计数算丢。
- 分页的 skip 不下推：先取回前面一整段，在内存里再切页。

### 5.6 内存版差异

没连库时用 `Map`（一个字典）全内存干同样的事：过滤、排序、软删、归档语义都一样，只是 accessCount 变成读出来改完再放回去（没有原子保障，但单进程内存里无所谓）。

---

## 6. elysia_bonds —— 关系表（生命体对每个人的"好感度档案"）

**这张表是干嘛的**：生命体对每个用户（或每个群）维护一份五维关系数值，像 galgame 的好感度面板。每次互动后按对话情绪微调数值；唤醒时把相关档案塞进 prompt（"你和他的关系"那段）。

### 6.1 一行长什么样（示例）

```js
{
  bond: {                              // ▼ 一行就是关系档案本身
    id: "bond-1791000000000-3",
    lifeId: "roza",                    //   roza 的关系档案
    targetId: "12345",                 //   对用户 12345
    targetType: "actor",               //   目标类型：一个用户（6 种规范值，见 6.2）
    status: "active",
    metrics: {                         //   ★ 五维数值（唯一权威版本）
      familiarity: 0.35,               //   熟悉度
      intimacy: 0.2,                   //   亲密度
      trust: 0.4,                      //   信任
      tension: 0.1,                    //   紧张/防备
      dependence: 0.05                 //   依赖
    },
    summary: "常聊动漫的群友",
    tags: ["群友"],
    source: { stimulusId: "stim-abc" },
    createdAt: 1790000000000,
    updatedAt: 1791000000000,
    lastInteractionAt: 1791000000000,  //   最近一次互动
    interactionCount: 27,              //   累计互动 27 次
    metadata: { lastSentiment: "positive" }
  }
}
```

### 6.2 targetType 的六种规范值

目标类型现在只有六个值，都是规范名：`actor`（用户）/ `life`（生命体）/ `habitat`（群）/ `thread`（话题）/ `projection`（投影）/ `external`（外部）。**旧别名（individual/collective/channel）已于 2026-10-11 随死字段清理移除**——以前为了兼容旧数据，查询时要把新旧名都展开匹配（查"用户"要同时命中 actor 和 individual）；现在写入时缺省补 `actor`、查询时等值/集合匹配，不再有展开逻辑。

同理，以前"旧版本把三个数值放顶层、后来收进 metrics 抽屉，为了兼容两处都写（双写）"的历史包袱也已移除：**数值只存在 `metrics` 里**，顶层不再有镜像字段。

### 6.3 索引（4 个）与两个细节

| 键 | 唯一 | 实际索引名 | 为什么 |
|---|---|---|---|
| { bond.id } | 是 | `elysia_bonds_id_unique` | 身份证（也是文档键） |
| { bond.lifeId, bond.status, bond.targetType, bond.targetId } | 否 | `elysia_bonds_life_status_target` | "roza 对用户 12345 的档案"这种直查 |
| { bond.lifeId, bond.status, bond.interactionCount ↓ } | 否 | `elysia_bonds_life_interaction` | 找互动最多的关系 |
| { bond.lifeId, bond.updatedAt ↓ } | 否 | `elysia_bonds_life_updated` | 找最近更新的关系 |

- **互动计数没有用 `$inc`**：interactionCount 是"读出来 +1 再整行存回"（和记忆表的 accessCount 形成对照）。因为关系更新频率低、并发窗口小，没必要上原子操作。
- 删除是软删（status='deleted' 进回收站）。

---

## 7. elysia_trigger_tasks —— 定时任务表（生命体的闹钟本）

**这张表是干嘛的**：存定时任务——"到点了，用这段提示词把某个生命体在某个群唤醒一次"（比如每天早上主动发个早安话题）。任务是 LLM 在对话里自己创建的（有配额限制：每个创建者最多 20 个），也支持 koishi 命令查看/删除/试跑。

### 7.1 一行长什么样（示例）

```js
{
  task: {                              // ▼ 一行就是任务本身（含运行状态）
    id: "trigger-1791000000000-1",
    name: "早安话题",
    enabled: true,
    lifeId: "roza",                    //   唤醒谁
    habitatId: "517086112",            //   在哪个群（'*' = 所有活跃的群）
    routing: {                         //   ★ 创建当时的"地址快照"
      platform: "onebot",
      botId: "10001",
      guildId: "517086112",
      channelId: "517086112"
    },
    condition: {                       //   什么时候响（三种格式见 7.2）
      type: "cron",
      expression: "0 9 * * *",         //   每天 9 点（分 时 日 月 周）
      timezone: "Asia/Shanghai",
      misfire: "skip"                  //   错过了怎么办：跳过等下次
    },
    prompt: "又是新的一天，想一个自然的话题和大家打招呼",
    ownerKey: "onebot:10001:12345",    //   谁创建的（平台:机器人:用户）
    createdAt: 1790000000000,          //   创建时间（interval 型任务的排程锚点）
    updatedAt: 1791000000000,
    state: {                           //   ▼ 任务自己的进度条/打卡记录
      status: "waiting",               //   排队等响铃
      nextRunAt: 1791363600000,        //   下次该响的时刻
      occurrenceKey: "2026-10-10T09:00", // 防重复响铃的"场次号"
      lastRunAt: 1791277200000,        //   上次响的时刻
      runCount: 6,                     //   一共响过 6 次
      lastError: null,
      pausedUntil: null                //   暂停到什么时候（没暂停就是 null）
    }
  }
}
```

### 7.2 condition——三种闹钟格式（判别联合）

先看 `type` 是哪种，后面跟的栏目不一样：

| type | 字段 | 大白话 |
|---|---|---|
| once | at（ISO 文字时刻） | 一次性闹钟：到点响一次就完 |
| interval | everyMinutes（分钟数）、anchorAt?（对齐时刻）、misfire? | 周期闹钟：每 N 分钟一次 |
| cron | expression（cron 表达式，如 `0 9 * * *` 每天 9 点）、timezone?、misfire? | 专业排班表，最灵活 |

`misfire` 是"错过了怎么办"：`skip` 跳过这次等下次（默认）/ `fire_once` 补响一次。这里的 `at`/`anchorAt` 是用户或 LLM 输入的原文（`"2026-10-10T09:00:00"` 这种），**全库唯一不用大数字时间戳的地方**——保留原样是为了不改写用户输入。

### 7.3 state.status——任务的五种状态

`waiting` 排队等响 / `running` 正在执行 / `paused` 暂停中（到 `pausedUntil` 时刻自动恢复）/ `completed` 已完成（一次性任务响完）/ `error` 出过错——**启动时会自动救活**（重排时间继续跑）。

### 7.4 routing——"地址快照"为什么单独存

任务创建时正在某个群聊天，就把"哪个平台、哪个机器人、哪个群"抄一份存进任务里。这样**重启之后**闹钟响了也知道该去哪儿发消息，不依赖当时那个聊天的上下文还活着。

### 7.5 防止同一个闹钟响两次：claim"举手抢答"

如果同一份程序跑了多个进程（或重启瞬间新旧进程重叠），可能两个进程都看到"这个任务到点了"，各唤醒一次——重复说话。防法是**举手抢答（CAS）**：谁先把这行任务的状态从 `waiting` 改成 `running` 谁获得执行权（查询条件要求"任务 id + 场次号 occurrenceKey + 当前是 waiting"三个都对得上才改得动）；数据库保证**只有一个进程能改成功**，改失败的看到状态已经是 running 就自知退让，并留一行小字 `claimed-elsewhere`（被别人抢了）作为排障线索。

### 7.6 索引（4 个）与日常查询

| 键 | 唯一 | 实际索引名 | 为什么 |
|---|---|---|---|
| { task.id } | 是 | `elysia_trigger_tasks_id_unique` | 身份证（也是文档键） |
| { task.habitatId } | 否 | `elysia_trigger_tasks_habitat` | 按群查任务 |
| { task.ownerKey } | 否 | `elysia_trigger_tasks_owner` | "我建的任务"、配额计数 |
| { task.enabled, state.status, state.nextRunAt } | 否 | `elysia_trigger_tasks_harvest` | **收割查询**：每秒问一次"有哪些到点的任务"，一条查询直达 |

删除是硬删（先查出来再直接删行）；任何读写失败都会发一条诊断事件，observatory 命令能看到。

---

## 8. 代码里的"格式说明书"（Zod schema）和表的关系

每类存在进表的数据，代码里都有一份对应的**格式说明书**（Zod schema）：入库前按说明书检查一遍格式对不对（字段齐不齐、选项值合不合法）。说明书和表里的字段**一一对应**：

| 说明书（代码文件） | 对应表里的内容 | 备注 |
|---|---|---|
| memoryEntrySchema | 记忆表的 entry | 逐字段一致 |
| bondSchema | 关系表的 bond | 逐字段一致（弃用字段与别名已随优化移除） |
| projectionRuleSchema | 路由表的 rule | 逐字段一致 |
| homeostasisStateSchema | 状态表的 state | 逐字段一致（lifeInstanceId 已移除） |
| TriggerTask（TS interface，**没写 Zod 说明书**） | 任务表的 task | 结构一致 |

生命体本身（LifeInstance）**不进数据库**——它只在启动时从 manifest.json 文件加载进内存。

---

## 9. 哪些数据**不**进数据库（重启即丢）

这些都是"短平快"的近期数据，丢了也无妨（重新聊几句就有了），所以特意只放内存：

| 数据 | 是什么 | 容量上限（笔记本页数） |
|---|---|---|
| 对话历史 conversationStore | 每个会话最近的往返消息 | 最多记住 300 个会话 × 每个会话最近 50 条 |
| 事件账本 EventHistory | 认知层记的"群里发生过什么" | 300 个作用域 × 每个最多 100 条（且只记 30 分钟内） |
| 事件包 EventsPackMemory | 每次唤醒时的事件快照存档 | 300 作用域 × 每个 12 包 |
| observatory 观测 | 全链路运行记录（错误/耗时） | 环形 500 条，旧的自动挤掉 |
| 生命体/栖息地/人格注册表 | manifest 加载后的运行时登记簿 | 无上限（本来就没几条） |
| 出站路由表 | "回复发回哪个聊天"的临时映射 | 500 条，先进先出 |

**分界线一句话**：人格与配置在 manifest/koishi.yml（文件）、长期状态在 MongoDB（可开可不开）、近期聊天上下文在内存（故意不存）。

---

## 10. 你现在的实际状态 & 怎么把数据库打开

**现状（2026-10 核验）**：koishi.yml 里 runtime 只配了 manifestPath，`stateRepository` 没配 → 用默认值 memory → **5 张表一张都没建**，记忆/关系/定时任务/状态全部只活在内存，重启即丢。宿主的 sqlite 文件（data/koishi.db）里只有 Koishi 框架自己的表，和 elysia 无关。

**想开启持久化**，在 koishi 控制台（或 koishi.yml）给 `elysia-ai-runtime` 补上：

```yaml
elysia-ai-runtime:
  manifestPath: data/elysia-ai/manifest/default.json
  stateRepository: mongo
  uri: mongodb://localhost:27017     # 你的 MongoDB 地址
  # database: elysia_ai              # 可不填，用默认库名
  # failFast: false                  # 可不填：连不上就退回内存模式
```

前提：本机或网络上有一个 MongoDB 实例。另外框架是运行时动态加载 mongo 驱动的——如果启动日志提示找不到 `mongodb` 模块，需要在宿主工作区装一下这个依赖再重启。

---

## 11. 设计取舍（每条配一句大白话）

- **一行 = 数据本身，无外层骨架（2026-10-11 起）**：以前外层那套"登记章"（外层 id/创建时间/修改时间）和信封内容重复且无人读，现已全部移除——文档键/唯一索引改走信封内 id，时间只看数据自带的时间戳。代价是查询键都要带 `entry.`/`bond.` 前缀。
- **没有 TTL（到期自动碎纸）**：归档的记忆、回收站里的软删数据会无限积累，只能靠"整理归档"（consolidate）主动清理——量大了以后要留意库的体积。
- **删除策略软硬并存**：记忆/关系进回收站（可追溯），任务/规则直接碎纸（可重建）——按数据性质分治。
- **互动计数不用原子 +1**：关系更新频率低，读改写足够；记忆的访问计数因为是高频路径才用了 `$inc`。
- **没有表结构版本号**：没做"结构迁移"机制——将来字段演进主要靠"新字段都可空"来向后兼容，改字段类型时要人工处理旧数据（2026-10-11 这轮清理正是因为项目尚无存量数据才敢整体换形态）。
- **时间全用大数字**：比大小、算间隔最方便；代价是用数据库工具肉眼看不出是几点几分（trigger 的 ISO 文字是唯一例外，因为那是用户原文）。
- **关键词搜索不在数据库做**：正文搜子串这种数据库做不了/做不好，宁可多取 3 倍数据回内存挑——数据量大了以后这里是潜在的性能优化点。

---

*数据快照：2026-10-11（字段优化实施后）。本轮优化：外层骨架移除（文档键走 `信封.id`）、state.lifeInstanceId / bond 弃用四项 / targetType 旧别名删除、HomeostasisDelta.lifeInstanceId 一并移除（事件载荷顶层已带，无读方）。验证：842/842 测试全绿、tsc 全量类型检查与 turbo build 通过。总体架构见 [elysia-ai-architecture.md](elysia-ai-architecture.md)。*
