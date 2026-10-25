import type {
  DialogueResult,
  DialogueTask,
} from '@elysia-ai/core'
import type { PlatformMessage } from '../types/index.js'
import { HabitatSendRegistry } from './habitat-send-registry.js'

export { HabitatSendRegistry } from './habitat-send-registry.js'
export type { HabitatSendEntry } from './habitat-send-registry.js'

export interface PlatformSendTarget {
  platform?: string
  botId?: string
  guildId?: string
  channelId?: string
  userId?: string
  habitatId?: string
  sourceStimulusId?: string
}

export interface PlatformSendTask {
  target: PlatformSendTarget
  content: string
  metadata?: Record<string, unknown>
}

export interface MessageSender {
  send(task: PlatformSendTask): Promise<void>
}

export interface OutboundRoute {
  sourceStimulusId: string
  message: PlatformMessage
  send(content: string): Promise<void>
}

const DEFAULT_MAX_ROUTES = 500

/**
 * body 层短期输出路由表。
 *
 * 当前阶段 dialogue.completed 只携带 sourceStimulusIds，不直接携带 Koishi session。
 * 因此 body 在接收输入时记录 stimulusId → 平台输出路由，
 * 输出时再通过 sourceStimulusId 找回发送目标。
 *
 * 这是 body 内部的短期桥接状态，不作为长期事实源。
 */
export class OutboundRouteRegistry {
  private routes = new Map<string, OutboundRoute>()

  constructor(private readonly maxRoutes = DEFAULT_MAX_ROUTES) {}

  remember(route: OutboundRoute): void {
    this.routes.set(route.sourceStimulusId, route)

    if (this.routes.size <= this.maxRoutes) return

    const oldestKey = this.routes.keys().next().value
    if (oldestKey) {
      this.routes.delete(oldestKey)
    }
  }

  get(sourceStimulusId: string): OutboundRoute | undefined {
    const direct = this.routes.get(sourceStimulusId)
    if (direct) return direct

    // followup 重放的 stimulus id 形如 "<原id>:followup:<ts>"，不在本表登记。
    // 剥掉后缀回退查原始入站消息的路由，延迟回复才能发回原会话（P1-7）。
    const marker = sourceStimulusId.indexOf(':followup:')
    if (marker > 0) {
      return this.routes.get(sourceStimulusId.slice(0, marker))
    }
    return undefined
  }

  clear(): void {
    this.routes.clear()
  }

  get size(): number {
    return this.routes.size
  }
}

export function createPlatformSendTaskFromDialogue(
  task: DialogueTask,
  result: DialogueResult,
  route?: OutboundRoute,
  options?: { content?: string }
): PlatformSendTask {
  const sourceStimulusId = route?.sourceStimulusId ?? task.sourceStimulusIds[0]

  // 合成触发刺激没有入站路由：behavior 在 task.metadata.routing 携带
  // habitat 目标（platform/channelId 等），route 缺失时作为发送目标来源。
  const routing = (task.metadata?.routing ?? {}) as {
    platform?: string
    botId?: string
    guildId?: string
    channelId?: string
  }

  return {
    target: {
      platform: route?.message.platform ?? routing.platform,
      botId: route?.message.botId ?? routing.botId,
      guildId: route?.message.guildId ?? routing.guildId,
      channelId: route?.message.channelId ?? routing.channelId,
      userId: route?.message.userId,
      habitatId: task.habitatId,
      sourceStimulusId,
    },
    // agentic 多段发言时每条 output 携带自己的段文本；单段/旧路径与 result.output 等价
    content: options?.content ?? result.output,
    metadata: {
      taskId: result.taskId,
      dialogueMode: task.mode,
      sourceStimulusIds: task.sourceStimulusIds,
      sourceMessageId: route?.message.id,
    },
  }
}

export type DirectSendFn = (
  target: { platform?: string, botId?: string, channelId?: string, guildId?: string },
  content: string,
) => Promise<void>

export class RouteMessageSender implements MessageSender {
  constructor(
    private readonly routes: OutboundRouteRegistry,
    /** habitat 级回退：合成触发刺激（批量/定时唤醒）没有入站路由时按平台通道发送。 */
    private readonly habitatRoutes?: HabitatSendRegistry,
    /** 终极兜底：经 koishi bot 直发（冷启动时 habitat 注册表也无 send 闭包） */
    private readonly directSend?: DirectSendFn,
  ) {}

  async send(task: PlatformSendTask): Promise<void> {
    const sourceStimulusId = task.target.sourceStimulusId

    if (sourceStimulusId) {
      const route = this.routes.get(sourceStimulusId)
      if (route) {
        await route.send(task.content)
        return
      }
    }

    // habitat 回退：route 缺失（合成触发刺激 / FIFO 淘汰）时按 platform+channelId 解析
    const fallback = this.habitatRoutes?.resolve(task.target.platform, task.target.channelId)
    if (fallback) {
      await fallback.send(task.content)
      return
    }

    // 直发兜底：重启后定时任务唤醒（habitat 注册表为空）按 platform+channelId 经 bot 发送
    if (this.directSend && task.target.platform && task.target.channelId) {
      await this.directSend(
        { platform: task.target.platform, botId: task.target.botId, channelId: task.target.channelId, guildId: task.target.guildId },
        task.content,
      )
      return
    }

    throw new Error(
      `Outbound route not found for stimulus "${sourceStimulusId ?? '(none)'}" `
      + `(platform=${task.target.platform ?? '?'}, channelId=${task.target.channelId ?? '?'})`,
    )
  }
}
