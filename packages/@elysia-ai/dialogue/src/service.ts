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
import { createConversationScopeKey } from '@elysia-ai/shared'
import { DefaultBrainService, runBrainToolLoop } from '@elysia-ai/brain'
import type { BrainToolEntry, ToolLoopResult } from '@elysia-ai/brain'

/**
 * agentic 任务元数据（behavior 唤醒时经 DialogueTask.metadata.agentic 注入）：
 * - tools：本轮可用工具（send_reply / stay_silent / get_event_history 等）；
 * - resolveOutput：从工具循环结果导出发言段与沉默决策——dialogue 不感知
 *   具体工具语义，输出协议由 behavior 定义。
 */
export interface AgenticTaskMeta {
  tools: BrainToolEntry[]
  resolveOutput?: (loop: ToolLoopResult) => { segments: string[]; silent: boolean; silentReason?: string }
  maxRounds?: number
}

export function readAgenticMeta(metadata?: Record<string, unknown>): AgenticTaskMeta | undefined {
  const agentic = metadata?.agentic
  if (!agentic || typeof agentic !== 'object') return undefined
  const meta = agentic as AgenticTaskMeta
  return Array.isArray(meta.tools) && meta.tools.length > 0 ? meta : undefined
}

function createConversationScopeKeyForTask(task: DialogueTask): string {
  // 与 cognition 读取侧共用 shared 的唯一实现（P0-2）
  return createConversationScopeKey(task.lifeId, task.scope)
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
  const scopeKey = createConversationScopeKeyForTask(task)
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
    const scopeKey = createConversationScopeKeyForTask(task)
    const currentUserContent = getCurrentUserContent(task)
    const brainRequest = await createBrainRequest(
      task,
      this.conversationStore,
      this.memoryLimit,
      this.memoryContextProvider,
      this.bondContextProvider,
    )

    // agentic 分支：工具循环（输出协议由 resolveOutput 判定，含三态沉默兜底）
    const agentic = readAgenticMeta(task.metadata)
    let output: string
    let agenticResult: { segments: string[]; silent: boolean; silentReason?: string; rounds: number; toolCallCount: number; stopReason: string } | undefined

    if (agentic) {
      const loop = await runBrainToolLoop(this.brainService, brainRequest, agentic.tools, {
        maxRounds: agentic.maxRounds,
      })
      const resolved = agentic.resolveOutput
        ? agentic.resolveOutput(loop)
        : { segments: loop.output ? [loop.output] : [], silent: !loop.output }
      // 沉默决策（显式 stay_silent）输出归零：模型 send_reply 后又 stay_silent 时
      // 实际零发送，对话历史若记 segments.join 会留下"未发出过的文本"。
      output = resolved.silent ? '' : resolved.segments.join('\n')
      agenticResult = {
        segments: resolved.segments,
        silent: resolved.silent,
        silentReason: resolved.silentReason,
        rounds: loop.rounds,
        toolCallCount: loop.toolCalls.length,
        stopReason: loop.stopReason,
      }
    } else {
      const brainResponse = await this.brainService.execute(brainRequest)
      output = brainResponse.output
    }

    if (currentUserContent) {
      // 对话史落一行摘要而非唤醒全文：全文含事件清单/pack 注入（数 KB），
      // memoryLimit 条历史会把同一批事件重放近 N 次，上下文与检索被稀释。
      // 本轮 LLM 输入仍是全文（messages 已拼好），仅历史记录用摘要。
      const historyContent = typeof task.metadata?.historySummary === 'string' && task.metadata.historySummary !== ''
        ? task.metadata.historySummary
        : currentUserContent
      this.conversationStore?.append(scopeKey, {
        role: 'user',
        content: historyContent,
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
      // 沉默也入史：模型下次能记得"上次看到这些事件时选择了沉默"
      content: output !== '' ? output : '（保持沉默）',
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
      output,
      messages: task.messages,
      metadata: {
        source: 'elysia-ai-dialogue',
        mode: task.mode,
        ...(agenticResult ? { agentic: agenticResult } : {}),
      },
    }
  }
}
