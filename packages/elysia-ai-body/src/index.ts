import { Context, Schema } from 'koishi'
import type { BodyService } from '@elysia-ai/core'
import type { Runtime } from 'koishi-plugin-elysia-ai-runtime'
import { getRequiredElysiaService, registerElysiaService } from '@elysia-ai/shared'
import { KoishiBodyAdapter } from './adapters/koishi/index.js'
import {
  createPlatformSendTaskFromDialogue,
  OutboundRouteRegistry,
  RouteMessageSender,
} from './sender/index.js'

export const name = 'elysia-ai-body'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export interface BodyPluginService extends BodyService {}

declare module 'koishi' {
  interface Context {
    'elysia.runtime'?: Runtime
    'elysia-ai-runtime'?: Runtime
    'elysia.body'?: BodyPluginService
    'elysia-ai-body'?: BodyPluginService
  }
}

export { handlePlatformMessage } from './message-handler.js'
export * from './types/index.js'
export * from './normalize/session-to-stimulus.js'
export * from './sender/index.js'
export * from './adapters/koishi/index.js'

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('elysia-ai-body')

  logger.info('body plugin apply started', {
    plugin: 'elysia-ai-body',
    phase: 'apply',
  })

  const runtime = getRequiredElysiaService<Runtime>(ctx, {
    formalName: 'elysia.runtime',
    legacyName: 'elysia-ai-runtime',
    logger,
    plugin: 'elysia-ai-body',
    description: 'runtime service',
  })

  if (!runtime) {
    return
  }

  logger.debug('runtime dependency resolved for body plugin', {
    plugin: 'elysia-ai-body',
    phase: 'apply',
  })

  const outboundRoutes = new OutboundRouteRegistry()
  const sender = new RouteMessageSender(outboundRoutes)

  const bodyService: BodyPluginService = {
    getOutboundRoutes() { return outboundRoutes },
    getSender() { return sender },
    getDiagnostics() {
      return {
        plugin: 'elysia-ai-body',
        enabled: true,
        ready: true,
        serviceName: 'elysia.body',
      }
    },
  }

  registerElysiaService(ctx, {
    formalName: 'elysia.body',
    legacyName: 'elysia-ai-body',
    service: bodyService,
    logger,
    plugin: 'elysia-ai-body',
  })

  const adapter = new KoishiBodyAdapter(ctx, runtime, {
    ...config,
    outboundRoutes,
  })
  adapter.registerListeners()

  const disposeDialogueOutput = runtime.context.eventBus.on('dialogue.output.created', async (output) => {
    const { task, result } = output

    if (task.mode !== 'reply-now') {
      logger.debug('body sender skipped non-reply dialogue output', {
        plugin: 'elysia-ai-body',
        phase: 'sender',
        mode: task.mode,
        stimulusId: output.stimulusId,
        outputId: output.outputId,
      })
      return
    }

    const sourceStimulusId = output.stimulusId
    const route = sourceStimulusId ? outboundRoutes.get(sourceStimulusId) : undefined
    const sendTask = createPlatformSendTaskFromDialogue(task, result, route)

    try {
      await runtime.context.eventBus.emit('sender.started', { task: sendTask })
      await sender.send(sendTask)
      await runtime.context.eventBus.emit('sender.completed', { task: sendTask })
      await runtime.context.eventBus.emit('body.message.sent', { task: sendTask })

      logger.info('body sender completed dialogue output', {
        plugin: 'elysia-ai-body',
        phase: 'sender',
        stimulusId: sourceStimulusId,
        outputId: output.outputId,
        channelId: sendTask.target.channelId,
        outputLength: sendTask.content.length,
      })
    } catch (error) {
      await runtime.context.eventBus.emit('sender.failed', { task: sendTask, error })
      await runtime.context.eventBus.emit('body.message.failed', { task: sendTask, error })

      logger.error('body sender failed dialogue output', error, {
        plugin: 'elysia-ai-body',
        phase: 'sender',
        stimulusId: sourceStimulusId,
        outputId: output.outputId,
        channelId: sendTask.target.channelId,
      })
    }
  })

  logger.info('body adapter registered', {
    plugin: 'elysia-ai-body',
    phase: 'adapter',
  })

  ctx.on('dispose', () => {
    disposeDialogueOutput()
    outboundRoutes.clear()
    adapter.removeListeners()
    logger.info('body adapter disposed', {
      plugin: 'elysia-ai-body',
      phase: 'dispose',
    })
  })
}
