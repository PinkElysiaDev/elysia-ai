/**
 * trigger 工具（LLM 自管理定时触发器）：单工具多 action（chatluna 式）。
 *
 * 工具描述即教学文档：三种条件的最小 JSON 示例、时区约定、
 * "先 get 再改"约定内置于 description——模型零外部文档即可构造合法配置。
 * 错误契约 {ok:false, code, message} 供模型自纠。
 * 权限：管理员（白名单/宿主回调）方可执行写操作；目标锁定当前 habitat。
 */

import type { BrainToolEntry } from '@elysia-ai/brain'
import type { TriggerTask } from '@elysia-ai/trigger'
import type { TriggerAdminActor, TriggerManager } from './trigger-manager.js'

export const TRIGGER_TOOL_DESCRIPTION = `管理定时触发器任务（持久化的定时唤醒，到期后你会被唤醒并执行 task.prompt）。

action 取值与所需参数：
- list: 列出触发器（可选 limit，默认 20）
- get: 查看单个触发器详情（需 id）
- create: 创建（需 task: {name, condition, prompt}；task.habitatId 可选，仅 create 支持且只能是 "*"=广播到全部活跃群/私聊，缺省=当前会话）
- update: 全量更新定义（需 id + task；先 get 查看再改）
- enable / disable: 启停（需 id）
- fire: 立即试跑一次（需 id）
- pause_until: 暂停到某时刻（需 id + at，未来 ISO 时间；不清除 enabled，enable/disable 是独立开关）
- resume: 恢复（需 id）
- remove: 删除（需 id）

condition 三种类型（最小示例）：
once（一次性）: {"type":"once","at":"2099-01-01T09:00:00+08:00"}
interval（固定间隔，锚点防漂移）: {"type":"interval","everyMinutes":30,"misfire":"skip"}
cron（单条或数组表达式，数组=任一匹配，用于"多个时刻"场景）:
  {"type":"cron","expression":"0 9 * * 1-5","timezone":"Asia/Shanghai"}
  {"type":"cron","expression":["0 9 * * 1-5","30 18 * * 1-5"],"timezone":"Asia/Shanghai"}  // 工作日 9:00 与 18:30
  // 时间窗循环用小时段表达："工作日 8-12 点每 20 分钟" = "*/20 8-11 * * 1-5"
  // 跳过本轮/今天剩余时段：醒来后直接调用 update 或 disable 即可

约定：
- 时间一律 ISO 格式且带显式时区偏移或 Z；时区用 IANA 名称（如 Asia/Shanghai）。
- cron 五段式（分 时 日 月 周），周日=0 或 7。
- prompt 是到期时给你的定向指令，写清楚要做什么（如"早间问候：看看群里昨晚聊了什么，自然地打个招呼"）。
- 一次性/临时任务用 once；值班/提醒类用 cron 或 interval。
- 任务面向当前会话的群/频道；只有管理员可以管理触发器。`

export interface TriggerToolContext {
  manager: TriggerManager
  /** 当前唤醒的会话定位（创建任务锁定目标） */
  habitatId: string
  lifeId?: string
  /**
   * 只读模式（定时/批量唤醒时置 true）：仅放行 list/get。
   * 定时唤醒的 actor 归因取点火前最后说话的人，写权限归因错配，
   * 故写操作一律拒绝（instant/manual 唤醒仍可写）。
   */
  readOnly?: boolean
  /** 触发本唤醒的发起者（权限判定） */
  actor: TriggerAdminActor
  /** 当前会话路由快照（创建任务时持久化，重启后恢复发送目标） */
  routing?: TriggerTask['routing']
}

export function createTriggerToolEntry(context: TriggerToolContext): BrainToolEntry {
  return {
    definition: {
      name: 'trigger',
      description: TRIGGER_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'enable', 'disable', 'fire', 'pause_until', 'resume', 'remove'] },
          id: { type: 'string', description: '任务 id（除 list/create 外必填）' },
          task: {
            type: 'object',
            description: 'create/update 的完整任务定义：{name, condition, prompt}',
          },
          at: { type: 'string', description: 'pause_until 的未来 ISO 时间戳' },
          limit: { type: 'number', description: 'list 返回条数上限（默认 20）' },
        },
        required: ['action'],
      },
    },
    async execute(rawArgs) {
      const args = rawArgs as {
        action: string
        id?: string
        task?: { name?: string, condition?: unknown, prompt?: string, habitatId?: string }
        at?: string
        limit?: number
      }
      try {
        return await executeTriggerAction(context, args)
      } catch (error) {
        return {
          ok: false,
          code: 'trigger-error',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

async function executeTriggerAction(
  context: TriggerToolContext,
  args: { action: string, id?: string, task?: { name?: string, condition?: unknown, prompt?: string, habitatId?: string }, at?: string, limit?: number },
): Promise<unknown> {
  const { manager } = context
  const readActions = new Set(['list', 'get'])

  // 只读模式（定时/批量唤醒）：写操作一律拒绝，权限判定也不必做。
  if (context.readOnly && !readActions.has(args.action)) {
    return { ok: false, code: 'trigger-forbidden', message: 'read-only during scheduled wake' }
  }

  let admin = false
  if (!readActions.has(args.action)) {
    admin = await manager.isAdmin(context.actor)
    if (!admin) {
      return { ok: false, code: 'trigger-forbidden', message: 'only admins can manage triggers' }
    }
  } else {
    // W2-7：读操作不再免检——非 admin 时 list 过滤到本 habitat（含广播任务），
    // get 非本 habitat 任务返回 forbidden（跨 habitat 信息不外泄）；admin 不变。
    admin = await manager.isAdmin(context.actor)
  }
  if (args.action !== 'list' && args.action !== 'create' && !args.id) {
    return { ok: false, code: 'trigger-invalid-input', message: 'id is required for this action' }
  }

  switch (args.action) {
    case 'list': {
      const tasks = await manager.list()
      // W2-7：非 admin 只见本 habitat（含广播任务）；W3：limit 0/负数回退默认 20。
      const visible = admin
        ? tasks
        : tasks.filter((task) => task.habitatId === context.habitatId || task.habitatId === '*')
      const limit = args.limit !== undefined && args.limit > 0 ? Math.min(50, args.limit) : 20
      return visible.slice(0, limit).map(summarizeTask)
    }
    case 'get': {
      const task = await manager.get(args.id!)
      if (!task) return notFound(args.id!)
      // W2-7：非 admin 访问非本 habitat 任务 → forbidden（不暴露存在性细节之外的跨会话任务体）。
      if (!admin && task.habitatId !== context.habitatId && task.habitatId !== '*') {
        return { ok: false, code: 'trigger-forbidden', message: 'trigger belongs to another habitat' }
      }
      return task
    }
    case 'create': {
      if (!args.task?.name || !args.task.condition || !args.task.prompt) {
        return { ok: false, code: 'trigger-invalid-input', message: 'task requires {name, condition, prompt}' }
      }
      // 目标锁定：缺省当前会话；仅额外允许 '*'（广播到该生命体的全部活跃窗口）
      const requestedHabitat = args.task.habitatId
      if (requestedHabitat !== undefined && requestedHabitat !== '*' && requestedHabitat !== context.habitatId) {
        return { ok: false, code: 'trigger-forbidden', message: 'habitatId can only be the current session or "*" for broadcast' }
      }
      const ownerKey = `${context.actor.platform ?? '?'}:${context.actor.botId ?? '?'}:${context.actor.userId ?? '?'}`
      const result = await manager.create({
        name: String(args.task.name),
        habitatId: requestedHabitat ?? context.habitatId,
        lifeId: context.lifeId,
        condition: args.task.condition as never,
        prompt: String(args.task.prompt),
        ownerKey,
        ...(context.routing ? { routing: context.routing } : {}),
      })
      if ('error' in result) return { ok: false, code: 'trigger-invalid-input', message: result.error }
      return result
    }
    case 'update': {
      if (!args.task?.name || !args.task.condition || !args.task.prompt) {
        return { ok: false, code: 'trigger-invalid-input', message: 'update requires full task {name, condition, prompt}' }
      }
      const result = await manager.update(args.id!, {
        name: String(args.task.name),
        condition: args.task.condition as never,
        prompt: String(args.task.prompt),
      })
      if ('error' in result) return { ok: false, code: 'trigger-invalid-input', message: result.error }
      return result
    }
    case 'enable': {
      const result = await manager.update(args.id!, { enabled: true })
      return 'error' in result ? badInput(result.error) : result
    }
    case 'disable': {
      const result = await manager.update(args.id!, { enabled: false })
      return 'error' in result ? badInput(result.error) : result
    }
    case 'fire': {
      const result = await manager.fire(args.id!)
      return 'error' in result ? badInput(result.error) : { ok: true, fired: args.id }
    }
    case 'pause_until': {
      if (!args.at) return badInput('at is required for pause_until')
      const at = Date.parse(args.at)
      if (Number.isNaN(at)) return badInput('at must be an ISO timestamp')
      const result = await manager.pauseUntil(args.id!, at)
      return 'error' in result ? badInput(result.error) : result
    }
    case 'resume': {
      const result = await manager.resume(args.id!)
      return 'error' in result ? badInput(result.error) : result
    }
    case 'remove': {
      const result = await manager.remove(args.id!)
      return 'error' in result ? badInput(result.error) : { ok: true, removed: args.id }
    }
    default:
      return badInput(`unknown action "${args.action}"`)
  }
}

function summarizeTask(task: TriggerTask): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    condition: task.condition,
    prompt: task.prompt,
    nextRunAt: task.state.nextRunAt ? new Date(task.state.nextRunAt).toISOString() : null,
    status: task.state.status,
    runCount: task.state.runCount,
  }
}

function notFound(id: string): unknown {
  return { ok: false, code: 'trigger-not-found', message: `trigger "${id}" not found` }
}

function badInput(message: string): unknown {
  return { ok: false, code: 'trigger-invalid-input', message }
}
