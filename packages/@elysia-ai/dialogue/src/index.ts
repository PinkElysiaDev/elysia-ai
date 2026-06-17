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
import { DefaultDialogueService } from './service.js'

export const internalName = 'elysia-ai-dialogue'

export interface Config {
  enabled: boolean
  memoryLimit: number
}

// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?// Dialogue task 闁圭粯鍔曡ぐ?// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?
function extractDialogueTasks(
  instruction: BehaviorExecutionInstruction
): { action: BehaviorAction & { type: 'dialogue' }; task: DialogueTask }[] {
  return instruction.actions
    .filter((a): a is BehaviorAction & { type: 'dialogue' } => a.type === 'dialogue')
    .map((action) => ({ action, task: action.task }))
}

// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?// Dialogue task 闁圭瑳鍡╂斀
// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?
async function executeOneDialogueTask(
  eventBus: EventBus<CoreEventMap>,
  service: DefaultDialogueService,
  instruction: BehaviorExecutionInstruction,
  task: DialogueTask
) {
  await eventBus.emit('dialogue.task.created', { task })
  await eventBus.emit('dialogue.generation.requested', { task })
  await eventBus.emit('dialogue.started', { task })
  const result = await service.execute(task)
  await eventBus.emit('dialogue.generated', { task, result })
  await eventBus.emit('dialogue.output.created', {
    outputId: `${instruction.stimulusId}:output`,
    stimulusId: instruction.stimulusId,
    habitatId: task.habitatId,
    threadId: task.metadata?.threadId as string | undefined,
    actorId: task.metadata?.actorId as string | undefined,
    content: result.output,
    task,
    result,
    messages: result.messages,
    metadata: {
      ...result.metadata,
      source: 'elysia-ai-dialogue',
    },
  })
  await eventBus.emit('dialogue.completed', { task, result })
  return result
}

// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?// Plugin apply
// 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?
type DialogueLoggerLike = {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface DialoguePluginRuntimeOptions {
  runtime: {
    context: { eventBus: EventBus<CoreEventMap> }
    conversationStore?: ConversationStore
    memoryContextProvider?: MemoryContextProvider
    bondContextProvider?: BondContextProvider
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
  const memoryContextProvider = memory?.contextProvider ?? runtime.memoryContextProvider
  const bondContextProvider = bond?.contextProvider ?? runtime.bondContextProvider
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

  const disposeInstruction = eventBus.on('behavior.instruction', async ({ instruction }) => {
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
