import type { BrainCapability, BrainService, DialogueMessage } from '@elysia-ai/core'
import {
  createSelectionDiagnostics,
  isTimeoutError,
  normalizeReasonById,
  normalizeSelectedIds,
  parseJsonObjectFromText,
  withTimeout,
} from './relevance-selection.js'

// ─────────────────────────────────────────────────
// AI 辅助相关性选择器：泛型基类
//
// memory / bond 两个 AI 选择器此前为 ~95% 镜像（各 ~165 行）。本基类收敛其共享骨架：
//   requested 事件 → 无 brain 即 fallback → execute(带超时) → 解析/规范化 →
//   构造 items（注入 aiSelected 元数据）→ 诊断 metadata → completed 事件；
//   失败走 fallback（携带错误诊断）+ failed/fallback 事件 + 日志。
//
// 各领域只需实现少量 hook（id 取值、selector 名、事件名、prompt 构造、fallback 选择器）。
// ─────────────────────────────────────────────────

/** 选择器对接的事件总线能力（仅 emit）。 */
export interface RelevanceEventEmitter {
  emit(event: string, payload: unknown): Promise<unknown> | unknown
}

export interface RelevanceSelectorLogger {
  error?(message: string, error?: unknown, meta?: Record<string, unknown>): void
}

/** 选择器共享的请求形状（memory/bond 的 request 均满足）。 */
export interface RelevanceRequestLike<TItem> {
  contextRequest: { lifeId: string, habitatId?: string, limit?: number, content?: string }
  candidates: TItem[]
  content?: string
  limit?: number
  metadata?: Record<string, unknown>
}

/** 选择器共享的结果形状（memory/bond 的 result 均满足）。 */
export interface RelevanceResultLike<TItem> {
  items: TItem[]
  selectedIds: string[]
  rejectedIds: string[]
  reason: string
  usedAI: boolean
  fallbackReason?: string
  metadata?: Record<string, unknown>
}

export interface AiAssistedRelevanceSelectorOptionsLike<TItem> {
  maxCandidates?: number
  defaultLimit?: number
  timeoutMs?: number
  fallbackSelector?: { select(request: RelevanceRequestLike<TItem>): Promise<RelevanceResultLike<TItem>> }
}

/** 各领域差异通过此描述符注入；基类承载全部共享逻辑。 */
export interface RelevanceSelectorDescriptor<TItem, TRequest extends RelevanceRequestLike<TItem>, TResult extends RelevanceResultLike<TItem>> {
  /** 诊断 metadata 里的 selector 名，如 'AiAssistedMemoryRelevanceSelector'。 */
  selectorName: string
  /** brain task / capability 标识，如 'memory-relevance-selection'。 */
  task: BrainCapability
  /** 失败日志 phase 字段，如 'memory-relevance-selection'。 */
  logPhase: string
  /** 用于人类可读 label 的标签，如 'memory relevance selection'。 */
  label: string
  /** 四个领域事件名：requested / completed / failed / fallback。 */
  events: { requested: string, completed: string, failed: string, fallback: string }
  /** 从候选项取出其 id。 */
  itemId(item: TItem): string
  /** 构造给 brain 的 messages（含 system 指令与 user 载荷）。 */
  buildMessages(request: TRequest, candidates: TItem[], limit: number): DialogueMessage[]
  /** 创建默认 fallback 选择器（无注入时使用）。 */
  createDefaultFallback(): { select(request: TRequest): Promise<TResult> }
}

export abstract class AiAssistedRelevanceSelectorBase<
  TItem,
  TRequest extends RelevanceRequestLike<TItem>,
  TResult extends RelevanceResultLike<TItem>,
> {
  protected readonly fallbackSelector: { select(request: TRequest): Promise<TResult> }

  constructor(
    protected readonly brainService: BrainService | undefined,
    protected readonly descriptor: RelevanceSelectorDescriptor<TItem, TRequest, TResult>,
    protected readonly eventBus?: RelevanceEventEmitter,
    protected readonly logger?: RelevanceSelectorLogger,
    protected readonly options: AiAssistedRelevanceSelectorOptionsLike<TItem> = {},
  ) {
    this.fallbackSelector = (options.fallbackSelector as { select(request: TRequest): Promise<TResult> } | undefined)
      ?? descriptor.createDefaultFallback()
  }

  async select(request: TRequest): Promise<TResult> {
    const d = this.descriptor
    await this.eventBus?.emit(d.events.requested, { request })

    if (!this.brainService) {
      const fallback = await this.runFallback(request, 'brain-service-not-configured')
      await this.eventBus?.emit(d.events.completed, { request, result: fallback })
      return fallback
    }

    const startedAt = Date.now()

    try {
      const limit = request.limit ?? request.contextRequest.limit ?? this.options.defaultLimit ?? 5
      const candidates = request.candidates.slice(0, this.options.maxCandidates ?? 20)
      const allowedIds = new Set(candidates.map((item) => d.itemId(item)))
      const response = await withTimeout(this.brainService.execute({
        task: d.task,
        lifeId: request.contextRequest.lifeId,
        habitatId: request.contextRequest.habitatId,
        capability: d.task,
        messages: d.buildMessages(request, candidates, limit),
        metadata: {
          ...request.metadata,
          phase: d.task,
          candidateCount: candidates.length,
        },
      }), this.options.timeoutMs, d.label)

      const parsed = parseJsonObjectFromText(response.output, d.label)
      const selectedIds = normalizeSelectedIds(parsed.selectedIds, allowedIds).slice(0, limit)
      if (selectedIds.length === 0) {
        throw new Error(`${d.label} returned no valid selectedIds`)
      }

      const reasonById = normalizeReasonById(parsed.reasonById)
      const byId = new Map(request.candidates.map((item) => [d.itemId(item), item]))
      const selectedSet = new Set(selectedIds)
      const items = selectedIds.flatMap((id) => {
        const item = byId.get(id)
        if (!item) return []
        return [{
          ...item,
          reason: reasonById[id] ?? (item as { reason?: string }).reason,
          metadata: {
            ...(item as { metadata?: Record<string, unknown> }).metadata,
            aiSelected: true,
            aiReason: reasonById[id],
          },
        } as TItem]
      })

      const result = {
        items,
        selectedIds,
        rejectedIds: request.candidates
          .filter((item) => !selectedSet.has(d.itemId(item)))
          .map((item) => d.itemId(item)),
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'ai-assisted-relevance-selection',
        usedAI: true,
        metadata: createSelectionDiagnostics({
          selector: d.selectorName,
          candidateCount: candidates.length,
          selectedCount: selectedIds.length,
          rejectedCount: request.candidates.length - selectedIds.length,
          usedAI: true,
          latencyMs: Date.now() - startedAt,
          timedOut: false,
          timeoutMs: this.options.timeoutMs,
          providerMetadata: response.metadata,
        }),
      } as TResult

      await this.eventBus?.emit(d.events.completed, { request, result })
      return result
    } catch (error) {
      const fallback = await this.runFallback(
        request,
        error instanceof Error ? error.message : 'ai-selection-failed',
        {
          latencyMs: Date.now() - startedAt,
          timedOut: isTimeoutError(error),
          timeoutMs: this.options.timeoutMs,
          parseError: error instanceof SyntaxError ? error.message : undefined,
        },
      )
      await this.eventBus?.emit(d.events.failed, { request, error, fallbackResult: fallback })
      this.logger?.error?.(`${d.label} failed, fallback used`, error, {
        phase: d.logPhase,
        lifeId: request.contextRequest.lifeId,
      })
      return fallback
    }
  }

  private async runFallback(
    request: TRequest,
    reason: string,
    diagnostics: { latencyMs?: number, timedOut?: boolean, timeoutMs?: number, parseError?: string } = {},
  ): Promise<TResult> {
    const d = this.descriptor
    const fallback = await this.fallbackSelector.select(request)
    const result = {
      ...fallback,
      usedAI: false,
      fallbackReason: reason,
      metadata: {
        ...fallback.metadata,
        ...createSelectionDiagnostics({
          selector: d.selectorName,
          fallbackSelector: typeof fallback.metadata?.selector === 'string'
            ? fallback.metadata.selector
            : undefined,
          candidateCount: request.candidates.length,
          selectedCount: fallback.selectedIds.length,
          rejectedCount: fallback.rejectedIds.length,
          usedAI: false,
          latencyMs: diagnostics.latencyMs,
          timedOut: diagnostics.timedOut,
          timeoutMs: diagnostics.timeoutMs,
          parseError: diagnostics.parseError,
          fallbackReason: reason,
        }),
      },
    } as TResult
    await this.eventBus?.emit(d.events.fallback, { request, result, reason })
    return result
  }
}
