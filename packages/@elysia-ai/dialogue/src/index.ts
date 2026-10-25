import type {
  BehaviorAction,
  BehaviorExecutionInstruction,
  BondContextProvider,
  BrainService,
  ConversationStore,
  CoreEventMap,
  DialogueTask,
  EventBus,
  MemoryContextProvider,
} from '@elysia-ai/core'
import { NS_BEHAVIOR, NS_DIALOGUE_OUTPUT, STAGE_DIALOGUE } from '@elysia-ai/core'
import { DefaultDialogueService } from './service.js'

export const internalName = 'elysia-ai-dialogue'

export interface Config {
  enabled: boolean
  memoryLimit: number
}

// ─── Dialogue task 提取 ───
function extractDialogueTasks(
  instruction: BehaviorExecutionInstruction
): { action: BehaviorAction & { type: 'dialogue' }; task: DialogueTask }[] {
  return instruction.actions
    .filter((a): a is BehaviorAction & { type: 'dialogue' } => a.type === 'dialogue')
    .map((action) => ({ action, task: action.task }))
}

// ─── 单条对话任务执行（事件发射 + agentic 输出协议） ───
async function executeOneDialogueTask(
  eventBus: EventBus<CoreEventMap>,
  service: DefaultDialogueService,
  instruction: BehaviorExecutionInstruction,
  task: DialogueTask,
  onOutput?: (output: CoreEventMap['dialogue.output.created']) => void,
  logger?: DialogueLoggerLike,
) {
  await eventBus.emit('dialogue.task.created', { task })
  await eventBus.emit('dialogue.generation.requested', { task })
  await eventBus.emit('dialogue.started', { task })
  const result = await service.execute(task)
  await eventBus.emit('dialogue.generated', { task, result })

  // agentic 输出协议：沉默 → 不产生任何 output（sender 无从发送）；
  // 多段发言（send_reply 多次调用）→ 每段一条 output，sender 逐条发送。
  const agentic = result.metadata?.agentic as
    | { segments?: string[]; silent?: boolean; silentReason?: string }
    | undefined

  if (agentic?.silent) {
    logger?.info('agentic dialogue chose silence; no output', {
      plugin: 'elysia-ai-dialogue',
      phase: 'dialogue',
      stimulusId: instruction.stimulusId,
      silentReason: agentic.silentReason,
    })
    await eventBus.emit('dialogue.completed', { task, result })
    return result
  }

  const contents = agentic?.segments?.length ? agentic.segments : [result.output]
  for (const [index, content] of contents.entries()) {
    const output: CoreEventMap['dialogue.output.created'] = {
      // 多段发言的 outputId 加段序号区分（sender/observatory 可按 id 对账）；
      // 单段保持无尾缀以兼容既有断言与消费者。
      outputId: index > 0 ? `${instruction.stimulusId}:output:${index}` : `${instruction.stimulusId}:output`,
      stimulusId: instruction.stimulusId,
      habitatId: task.habitatId,
      threadId: task.metadata?.threadId as string | undefined,
      actorId: task.metadata?.actorId as string | undefined,
      content,
      task,
      result,
      messages: result.messages,
      metadata: {
        ...result.metadata,
        source: 'elysia-ai-dialogue',
      },
    }
    await eventBus.emit('dialogue.output.created', output)
    // 管线路径：输出累积进共享上下文，sender 阶段逐条发送（事件照发不变）。
    onOutput?.(output)
  }
  await eventBus.emit('dialogue.completed', { task, result })
  return result
}

// ─── Plugin apply ───
type DialogueLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface DialoguePluginRuntimeOptions {
  runtime: {
    /** 阶段钩子装配所用的 kernel 管线（主链单轨：处理走钩子，事件只做事实通知）。 */
    context: { eventBus: EventBus<CoreEventMap>, pipeline: import('@elysia-ai/core').PipelineRunner<unknown> }
    conversationStore?: ConversationStore
  }
  brain: BrainService
  memory?: { contextProvider?: MemoryContextProvider }
  bond?: { contextProvider?: BondContextProvider }
  config: Config
  logger: DialogueLoggerLike
}

export interface DialoguePluginRuntime {
  service: DefaultDialogueService
  dispose(): void
}

export function createDialoguePluginRuntime(options: DialoguePluginRuntimeOptions): DialoguePluginRuntime | undefined {
  const { runtime, brain, memory, bond, config, logger } = options

  logger.info('dialogue plugin apply started', {
    plugin: 'elysia-ai-dialogue',
    phase: 'apply',
  })

  if (config.enabled === false) {
    logger.info('dialogue plugin disabled by config', {
      plugin: 'elysia-ai-dialogue',
      phase: 'apply',
    })
    return undefined
  }

  const eventBus = runtime.context.eventBus
  const conversationStore = runtime.conversationStore
  const memoryContextProvider = memory?.contextProvider
  const bondContextProvider = bond?.contextProvider
  const dialogueService = new DefaultDialogueService(
    brain,
    conversationStore,
    config.memoryLimit,
    memoryContextProvider,
    bondContextProvider,
  )

  logger.info('dialogue plugin ready', {
    plugin: 'elysia-ai-dialogue',
    phase: 'apply',
    hasConversationStore: Boolean(conversationStore),
    hasMemoryContextProvider: Boolean(memoryContextProvider),
    hasBondContextProvider: Boolean(bondContextProvider),
    memoryLimit: config.memoryLimit,
  })

  const handleInstruction = async (
    instruction: BehaviorExecutionInstruction,
    onOutput?: (output: CoreEventMap['dialogue.output.created']) => void,
  ): Promise<void> => {
    logger.debug('dialogue executor received instruction', {
      plugin: 'elysia-ai-dialogue',
      phase: 'dialogue',
      event: 'behavior.instruction',
      stimulusId: instruction.stimulusId,
      lifeId: instruction.lifeId,
      actionCount: instruction.actions.length,
      actionTypes: instruction.actions.map((a) => a.type),
    })

    const dialogueTasks = extractDialogueTasks(instruction)

    if (dialogueTasks.length === 0) {
      logger.debug('no dialogue action in instruction, skipping', {
        plugin: 'elysia-ai-dialogue',
        phase: 'dialogue',
        stimulusId: instruction.stimulusId,
      })
      return
    }

    for (const { task } of dialogueTasks) {
      if (!task.lifeId && instruction.lifeId) {
        task.lifeId = instruction.lifeId
      }

      logger.info('dialogue task execution started', {
        plugin: 'elysia-ai-dialogue',
        phase: 'dialogue',
        stimulusId: instruction.stimulusId,
        scope: task.scope.type,
        mode: task.mode,
        sourceStimulusCount: task.sourceStimulusIds.length,
      })

      try {
        const result = await executeOneDialogueTask(
          eventBus,
          dialogueService,
          instruction,
          task,
          onOutput,
          logger,
        )

        logger.info('dialogue completed', {
          plugin: 'elysia-ai-dialogue',
          phase: 'dialogue',
          stimulusId: instruction.stimulusId,
          scope: task.scope.type,
          mode: task.mode,
          outputLength: result.output.length,
        })
      } catch (error) {
        await eventBus.emit('dialogue.failed', { task, error })

        logger.error('dialogue execution failed', error, {
          plugin: 'elysia-ai-dialogue',
          phase: 'dialogue',
          stimulusId: instruction.stimulusId,
          scope: task.scope.type,
          mode: task.mode,
        })
      }
    }
  }

  // ── 装配：kernel 管线阶段钩子（主链单轨：读共享上下文里的 instruction）──
  const pipeline = runtime.context.pipeline
  const disposeInstruction = pipeline.registerHook({
    stage: STAGE_DIALOGUE,
    owner: 'elysia-ai-dialogue',
    async run(pctx) {
      const instruction = pctx.read<BehaviorExecutionInstruction>(NS_BEHAVIOR)
      if (!instruction) return
      // 输出累积写入 NS_DIALOGUE_OUTPUT（数组化，多 task 场景逐条追加），
      // sender 阶段读取发送。
      const outputs = pctx.read<CoreEventMap['dialogue.output.created'][]>(NS_DIALOGUE_OUTPUT) ?? []
      pctx.write(NS_DIALOGUE_OUTPUT, outputs, 'accumulate-begin')
      await handleInstruction(instruction, (output) => {
        const current = pctx.read<CoreEventMap['dialogue.output.created'][]>(NS_DIALOGUE_OUTPUT) ?? []
        pctx.write(NS_DIALOGUE_OUTPUT, [...current, output], 'output-created')
      })
    },
  })

  return {
    service: dialogueService,
    dispose() {
      disposeInstruction()
      logger.info('dialogue plugin disposed', {
        plugin: 'elysia-ai-dialogue',
        phase: 'dispose',
      })
    },
  }
}
