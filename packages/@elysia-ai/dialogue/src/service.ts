import type {
  BondContextProvider,
  BrainRequest,
  BrainService,
  ConversationEntry,
  ConversationStore,
  DialogueMessage,
  DialogueResult,
  DialogueService,
  DialogueTask,
  MemoryContextProvider,
} from '@elysia-ai/core'
import { DefaultBrainService } from '@elysia-ai/brain'

function createConversationScopeKey(task: DialogueTask): string {
  const lifePart = task.lifeId ?? 'global'
  return `${lifePart}:${task.scope.type}:${task.scope.key}`
}

function entriesToMessages(entries: ConversationEntry[]): DialogueMessage[] {
  return entries.map((entry) => ({
    role: entry.role,
    content: entry.content,
    metadata: {
      ...entry.metadata,
      stimulusId: entry.stimulusId,
      source: 'elysia-ai-conversation-memory',
    },
  }))
}

function getCurrentUserContent(task: DialogueTask): string | undefined {
  const content = task.metadata?.currentUserContent
  return typeof content === 'string' && content.length > 0 ? content : undefined
}

async function createBrainRequest(
  task: DialogueTask,
  conversationStore?: ConversationStore,
  memoryLimit = 10,
  memoryContextProvider?: MemoryContextProvider,
  bondContextProvider?: BondContextProvider,
): Promise<BrainRequest> {
  const scopeKey = createConversationScopeKey(task)
  const history = conversationStore?.getRecent(scopeKey, memoryLimit) ?? []
  const currentUserContent = getCurrentUserContent(task)
  const actorId = typeof task.metadata?.actorId === 'string' ? task.metadata.actorId : undefined
  const threadId = typeof task.metadata?.threadId === 'string' ? task.metadata.threadId : undefined
  const memoryContext = task.lifeId && memoryContextProvider
    ? await memoryContextProvider.buildContext({
      lifeId: task.lifeId,
      stimulusId: task.sourceStimulusIds[0],
      actorId,
      habitatId: task.habitatId,
      threadId,
      content: currentUserContent ?? task.messages.map((message) => message.content).join('\n'),
      limit: 5,
      metadata: {
        source: 'elysia-ai-dialogue',
        dialogueMode: task.mode,
        conversationScopeKey: scopeKey,
      },
    })
    : undefined
  const bondContext = task.lifeId && bondContextProvider
    ? await bondContextProvider.buildContext({
      lifeId: task.lifeId,
      actorId,
      habitatId: task.habitatId,
      threadId,
      limit: 5,
      metadata: {
        source: 'elysia-ai-dialogue',
        dialogueMode: task.mode,
        conversationScopeKey: scopeKey,
      },
    })
    : undefined

  const messages: DialogueMessage[] = [
    ...task.messages,
    ...entriesToMessages(history),
  ]

  if (currentUserContent) {
    messages.push({
      role: 'user',
      content: currentUserContent,
      metadata: {
        source: 'elysia-ai-current-stimulus',
        stimulusId: task.sourceStimulusIds[0],
      },
    })
  }

  return {
    task: 'dialogue-generation',
    lifeId: task.lifeId,
    habitatId: task.habitatId,
    capability: 'dialogue-generation',
    messages,
    systemPrompt: undefined,
    contextWindow: undefined,
    memoryContext,
    bondContext,
    metadata: {
      ...task.metadata,
      dialogueMode: task.mode,
      sourceStimulusIds: task.sourceStimulusIds,
      conversationScopeKey: scopeKey,
      conversationHistoryCount: history.length,
      memoryContextItemCount: memoryContext?.items.length ?? 0,
      bondContextItemCount: bondContext?.items.length ?? 0,
    },
  }
}

export class DefaultDialogueService implements DialogueService {
  constructor(
    private readonly brainService: BrainService = new DefaultBrainService(),
    private readonly conversationStore?: ConversationStore,
    private readonly memoryLimit = 10,
    private readonly memoryContextProvider?: MemoryContextProvider,
    private readonly bondContextProvider?: BondContextProvider,
  ) {}

  async execute(task: DialogueTask): Promise<DialogueResult> {
    const scopeKey = createConversationScopeKey(task)
    const currentUserContent = getCurrentUserContent(task)
    const brainRequest = await createBrainRequest(
      task,
      this.conversationStore,
      this.memoryLimit,
      this.memoryContextProvider,
      this.bondContextProvider,
    )
    const brainResponse = await this.brainService.execute(brainRequest)

    if (currentUserContent) {
      this.conversationStore?.append(scopeKey, {
        role: 'user',
        content: currentUserContent,
        timestamp: Date.now(),
        stimulusId: task.sourceStimulusIds[0],
        lifeId: task.lifeId,
        metadata: {
          source: 'elysia-ai-dialogue',
          mode: task.mode,
        },
      })
    }

    this.conversationStore?.append(scopeKey, {
      role: 'assistant',
      content: brainResponse.output,
      timestamp: Date.now(),
      stimulusId: task.sourceStimulusIds[0],
      lifeId: task.lifeId,
      metadata: {
        source: 'elysia-ai-dialogue',
        mode: task.mode,
      },
    })

    return {
      taskId: task.sourceStimulusIds[0],
      output: brainResponse.output,
      messages: brainResponse.messages ?? task.messages,
      metadata: {
        ...brainResponse.metadata,
        source: 'elysia-ai-dialogue',
        mode: task.mode,
        capability: brainResponse.capability,
      },
    }
  }
}
