import type { Context } from 'koishi'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import { elementToPlainText, sessionToPlatformMessage } from './session-to-platform-message.js'
import { platformEventToStimulus, platformMessageToStimulus } from '../../normalize/session-to-stimulus.js'
import type { HabitatSendRegistry, OutboundRouteRegistry } from '../../sender/index.js'

/** 从 notice session 提取发起者 id（onebot 透传与原生字段双路径）。 */
function raw_userId(session: ReactionNoticeSession): string | undefined {
  const raw = session.onebot ?? session.event?._data
  const fromPayload = raw?.['user_id']
  if (fromPayload !== undefined) return String(fromPayload)
  return session.userId
}

/** 表情回应通知 session 的防御性形状（官方/分支适配器差异容忍）。 */
interface ReactionNoticeSession {
  subtype?: string
  platform?: string
  selfId?: string
  guildId?: string
  channelId?: string
  userId?: string
  username?: string
  onebot?: Record<string, unknown>
  event?: { _data?: Record<string, unknown> }
}

/**
 * KoishiBodyAdapter 配置
 */
export interface KoishiBodyAdapterConfig {
  outboundRoutes?: OutboundRouteRegistry
  /** habitat 级发送注册表（合成触发刺激的发送回退） */
  habitatRoutes?: HabitatSendRegistry
  /** 是否将 bot 自身输出归一为 bot-sent 事件（模型自我认知来源），默认开 */
  recordBotSent?: boolean
  /** 是否监听群成员增减事件，默认开 */
  recordMemberEvents?: boolean
}

/**
 * Koishi 适配器
 * 负责监听 Koishi 消息/事件并转发到 Elysia A.I. runtime。
 *
 * 职责边界（来自项目设计文档 §7.3）：
 * - 只负责"接世界"：Koishi session → PlatformMessage → Stimulus → runtime
 * - 不做任何行为判断（要不要回复、用户关系等）
 * - Stimulus 构造统一通过 normalize 模块的构造函数，禁止内联
 */
export class KoishiBodyAdapter {
  private disposables: (() => void)[] = []

  constructor(
    private ctx: Context,
    private runtime: Runtime,
    private config: KoishiBodyAdapterConfig = {}
  ) {}

  /**
   * 注册消息与平台事件监听
   */
  registerListeners(): void {
    const logger = this.ctx.logger('elysia-ai-body')

    logger.debug('registering koishi body adapter listeners', {
      plugin: 'elysia-ai-body',
      phase: 'adapter',
    })

    const recordBotSent = this.config.recordBotSent !== false
    const recordMemberEvents = this.config.recordMemberEvents !== false

    // 监听所有消息（含 bot 自身输出：message_sent 也走 'message' 事件）
    const dispose = this.ctx.on('message', async (session) => {
      try {
        const isSelf = session.userId && session.userId === session.selfId

        if (isSelf) {
          // bot 自身输出也顺带登记 habitat 发送路由（只有 bot 主动发言的
          // 窗口——如定时任务冷启动后的主动消息——也能获得回退路由）。
          if (session.platform && session.channelId) {
            this.config.habitatRoutes?.register({
              platform: session.platform,
              channelId: session.channelId,
              send: async (content) => {
                await session.send(content)
              },
            })
          }
          // bot 自身输出 → bot-sent 事件刺激（feed-only，不触发合并，无循环风险）。
          // 保留 P0-1 的语义：自身消息不再作为 utterance 刺激进入主链。
          if (recordBotSent && session.channelId) {
            // W3：bot-sent 内容纯文本化——session.content 可能带 Koishi 元素标记串
            // （如 <at id="x"/>），进入 feed/记忆会污染后续检索；有 elements 时
            // 复用 elementToPlainText 提取，无 elements 用原 content。
            const botSentContent = Array.isArray(session.elements) && session.elements.length > 0
              ? session.elements.map((element) => elementToPlainText(element as never)).join('')
              : session.content ?? ''
            const stimulus = platformEventToStimulus({
              eventKind: 'bot-sent',
              platform: session.platform,
              botId: session.selfId,
              guildId: session.guildId,
              channelId: session.channelId,
              userId: session.selfId,
              userName: session.bot?.user?.name,
              content: botSentContent,
              timestamp: session.timestamp,
            })
            await this.runtime.receiveStimulus(stimulus)
          }
          return
        }

        logger.info('body received platform message', {
          plugin: 'elysia-ai-body',
          phase: 'input',
          platform: session.platform,
          botId: session.bot?.selfId,
          channelId: session.channelId,
          userId: session.userId,
        })

        // Step 1: Koishi session → 平台无关消息
        const platformMessage = sessionToPlatformMessage(session)

        // Step 2: 平台无关消息 → 系统内部刺激（统一转换入口）
        const stimulus = platformMessageToStimulus(platformMessage)

        this.config.outboundRoutes?.remember({
          sourceStimulusId: stimulus.id,
          message: platformMessage,
          send: async (content) => {
            await session.send(content)
          },
        })

        // habitat 级发送注册（合成触发刺激的回退路由；重复 habitat 刷新位置）
        if (session.platform && session.channelId) {
          this.config.habitatRoutes?.register({
            platform: session.platform,
            channelId: session.channelId,
            send: async (content) => {
              await session.send(content)
            },
          })
        }

        logger.debug('stimulus created from platform message', {
          plugin: 'elysia-ai-body',
          phase: 'normalize',
          stimulusId: stimulus.id,
          stimulusType: stimulus.type,
          habitatId: stimulus.habitatId,
        })

        // Step 3: 将刺激注入 runtime
        await this.runtime.receiveStimulus(stimulus)
      } catch (error) {
        logger.error('error handling incoming platform message', error, {
          plugin: 'elysia-ai-body',
          phase: 'input',
        })
      }
    })

    this.disposables.push(dispose)

    if (recordMemberEvents) {
      // 群成员增减 → appearance 事件刺激（social 组，参与密度合并）
      this.disposables.push(this.ctx.on('guild-member-added', async (session) => {
        await this.emitMemberEvent(session, 'member-added')
      }))
      this.disposables.push(this.ctx.on('guild-member-removed', async (session) => {
        await this.emitMemberEvent(session, 'member-removed')
      }))
    }

    // 表情回应桥接（防御性，零风险）：官方 onebot 适配器把 QQ 群贴表情
    // （notice group_msg_emoji_like）在 adaptSession 内直接丢弃，插件层无感知；
    // 换用带 NapCat 扩展的分支适配器（如 @wittf/koishi-plugin-adapter-onebot）
    // 后该通知以 notice/group-msg-emoji-like 上报，此桥接自动生效。
    // 频道场景的 onebot/message-reactions-updated 同样归一。
    const handleReactionNotice = async (session: unknown): Promise<void> => {
      await this.emitReactionEvent(session as ReactionNoticeSession)
    }
    const on = this.ctx.on as unknown as (event: string, listener: (session: unknown) => void | Promise<void>) => () => void
    this.disposables.push(on('notice', handleReactionNotice))
    this.disposables.push(on('onebot', handleReactionNotice))
  }

  private async emitReactionEvent(session: ReactionNoticeSession): Promise<void> {
    try {
      const subtype = session?.subtype
      // 兼容两种命名：@wittf 分支用连字符（hyphenate），OneBot 原生为下划线
      const isEmojiLike = subtype === 'group-msg-emoji-like' || subtype === 'group_msg_emoji_like'
      if (!isEmojiLike && subtype !== 'message-reactions-updated') return

      // selfId 过滤：bot 自己（经 add_reaction 工具）贴的表情不计入——
      // reaction 属 social 组参与密度合并，不过滤会造成 bot 自激励。
      const rawUserId = raw_userId(session)
      if (session.selfId && rawUserId === String(session.selfId)) return

      // 原始 OneBot payload：@wittf 分支经 session.onebot 透传；
      // 频道场景 event._data 携带 reaction 对象。
      const raw = (session.onebot ?? session.event?._data ?? {}) as Record<string, unknown>
      const likes = Array.isArray(raw['likes']) ? raw['likes'] as Array<Record<string, unknown>> : undefined
      const reaction = typeof raw['reaction'] === 'object' && raw['reaction'] !== null
        ? raw['reaction'] as Record<string, unknown>
        : undefined
      const emoji = String(likes?.[0]?.['emoji_id'] ?? reaction?.['emoji_id'] ?? '')
      const count = Number(likes?.[0]?.['count'] ?? reaction?.['count'] ?? 1) || 1

      const guildId = raw['group_id'] !== undefined ? String(raw['group_id']) : session.guildId
      const channelId = raw['channel_id'] !== undefined ? String(raw['channel_id']) : session.channelId
      if (!guildId && !channelId) return

      const stimulus = platformEventToStimulus({
        eventKind: 'reaction',
        platform: session.platform,
        botId: session.selfId,
        guildId,
        channelId: channelId ?? guildId,
        userId: raw_userId(session),
        userName: session.username,
        extra: {
          emoji,
          count,
          messageId: raw['message_id'] !== undefined ? String(raw['message_id']) : undefined,
        },
      })
      await this.runtime.receiveStimulus(stimulus)
    } catch (error) {
      const logger = this.ctx.logger('elysia-ai-body')
      logger.error('error handling reaction notice', error, {
        plugin: 'elysia-ai-body',
        phase: 'input',
      })
    }
  }

  private async emitMemberEvent(
    session: {
      platform?: string
      selfId?: string
      guildId?: string
      channelId?: string
      userId?: string
      username?: string
      timestamp?: number
      event?: { user?: { name?: string } }
    },
    eventKind: 'member-added' | 'member-removed',
  ): Promise<void> {
    try {
      if (!session.guildId) return
      const stimulus = platformEventToStimulus({
        eventKind,
        platform: session.platform,
        botId: session.selfId,
        guildId: session.guildId,
        channelId: session.channelId ?? session.guildId,
        userId: session.userId,
        userName: session.username || session.event?.user?.name,
        timestamp: session.timestamp,
      })
      await this.runtime.receiveStimulus(stimulus)
    } catch (error) {
      const logger = this.ctx.logger('elysia-ai-body')
      logger.error(`error handling ${eventKind} event`, error, {
        plugin: 'elysia-ai-body',
        phase: 'input',
      })
    }
  }

  /**
   * 移除消息监听
   */
  removeListeners(): void {
    const logger = this.ctx.logger('elysia-ai-body')

    logger.debug('removing koishi body adapter listeners', {
      plugin: 'elysia-ai-body',
      phase: 'dispose',
      listenerCount: this.disposables.length,
    })

    for (const dispose of this.disposables) {
      dispose()
    }
    this.disposables = []
  }
}
