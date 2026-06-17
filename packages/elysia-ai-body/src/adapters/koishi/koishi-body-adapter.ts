import type { Context } from 'koishi'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import { sessionToPlatformMessage } from './session-to-platform-message.js'
import { platformMessageToStimulus } from '../../normalize/session-to-stimulus.js'
import type { OutboundRouteRegistry } from '../../sender/index.js'

/**
 * KoishiBodyAdapter 配置
 */
export interface KoishiBodyAdapterConfig {
  outboundRoutes?: OutboundRouteRegistry
}

/**
 * Koishi 适配器
 * 负责监听 Koishi 消息并转发到 Elysia A.I. runtime。
 *
 * 职责边界（来自项目设计文档 §7.3）：
 * - 只负责"接世界"：Koishi session → PlatformMessage → Stimulus → runtime
 * - 不做任何行为判断（要不要回复、用户关系等）
 * - Stimulus 构造统一通过 platformMessageToStimulus() 函数，禁止内联
 */
export class KoishiBodyAdapter {
  private disposables: (() => void)[] = []

  constructor(
    private ctx: Context,
    private runtime: Runtime,
    private config: KoishiBodyAdapterConfig = {}
  ) {}

  /**
   * 注册消息监听
   */
  registerListeners(): void {
    const logger = this.ctx.logger('elysia-ai-body')

    logger.debug('registering koishi body adapter listeners', {
      plugin: 'elysia-ai-body',
      phase: 'adapter',
    })

    // 监听所有消息
    const dispose = this.ctx.on('message', async (session) => {
      try {
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

        logger.debug('session converted to platform message', {
          plugin: 'elysia-ai-body',
          phase: 'normalize',
          platform: platformMessage.platform,
          botId: platformMessage.botId,
          channelId: platformMessage.channelId,
          userId: platformMessage.userId,
          messageId: platformMessage.id,
          contentPreview: platformMessage.content?.slice(0, 120),
        })
        
        // Step 2: 平台无关消息 → 系统内部刺激（统一转换入口）
        const stimulus = platformMessageToStimulus(platformMessage)

        this.config.outboundRoutes?.remember({
          sourceStimulusId: stimulus.id,
          message: platformMessage,
          send: async (content) => {
            await session.send(content)
          },
        })

        logger.info('platform message converted to stimulus', {
          plugin: 'elysia-ai-body',
          phase: 'normalize',
          stimulusId: stimulus.id,
          stimulusType: stimulus.type,
          habitatId: stimulus.habitatId,
        })

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
