import type {
  BehaviorExecutionAction,
  BehaviorExecutionActionResult,
  BehaviorExecutionPlan,
  BehaviorExecutionResult,
  BehaviorExecutionService,
  BondUpdateRequest,
  CoreEventMap,
  DialogueTask,
  EventBus,
  HomeostasisUpdateRequest,
  MemoryUpdateRequest,
} from '@elysia-ai/core'
import type { RuntimeLogger } from '../context/index.js'

export interface BehaviorExecutionServiceOptions {
  failurePolicy?: 'continue' | 'stop-on-critical'
}

function cloneAction(
  action: BehaviorExecutionAction,
  status: BehaviorExecutionAction['status'],
  timestamp: number,
  patch: Partial<BehaviorExecutionAction> = {},
): BehaviorExecutionAction {
  return {
    ...action,
    status,
    attempts: status === 'running' ? action.attempts + 1 : action.attempts,
    startedAt: status === 'running' ? timestamp : action.startedAt,
    completedAt: status === 'completed' ? timestamp : action.completedAt,
    failedAt: status === 'failed' ? timestamp : action.failedAt,
    skippedAt: status === 'skipped' ? timestamp : action.skippedAt,
    ...patch,
  }
}

function isDialogueTask(value: unknown): value is DialogueTask {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Partial<DialogueTask>).mode === 'string'
    && Array.isArray((value as Partial<DialogueTask>).sourceStimulusIds)
}

export class DefaultBehaviorExecutionService implements BehaviorExecutionService {
  constructor(
    private readonly eventBus: EventBus<CoreEventMap>,
    private readonly logger?: RuntimeLogger,
    private readonly options: BehaviorExecutionServiceOptions = {},
  ) {}

  async execute(plan: BehaviorExecutionPlan): Promise<BehaviorExecutionResult> {
    const startedAt = Date.now()
    const runningPlan: BehaviorExecutionPlan = {
      ...plan,
      status: 'running',
      startedAt,
    }

    await this.eventBus.emit('behavior.execution.started', {
      planId: runningPlan.id,
      plan: runningPlan,
    })

    const actionResults: BehaviorExecutionActionResult[] = []

    try {
      const actions = [...runningPlan.actions].sort((a, b) => b.priority - a.priority)
      for (const action of actions) {
        const result = await this.executeAction(runningPlan, action)
        actionResults.push(result)

        if (!result.completed && this.options.failurePolicy === 'stop-on-critical') {
          throw result.error ?? new Error(`behavior execution action failed: ${action.id}`)
        }
      }

      const completedAt = Date.now()
      const completed = actionResults.every((result) => result.completed || result.skipped)
      const finalPlan: BehaviorExecutionPlan = {
        ...runningPlan,
        status: completed ? 'completed' : 'partial',
        completedAt,
      }
      const result: BehaviorExecutionResult = {
        planId: finalPlan.id,
        completed,
        status: finalPlan.status,
        actionResults,
        startedAt,
        completedAt,
      }

      await this.eventBus.emit('behavior.execution.completed', {
        planId: finalPlan.id,
        plan: finalPlan,
        result,
      })

      return result
    } catch (error) {
      const completedAt = Date.now()
      const failedPlan: BehaviorExecutionPlan = {
        ...runningPlan,
        status: 'failed',
        failedAt: completedAt,
        lastError: error instanceof Error ? error.message : String(error),
      }
      const result: BehaviorExecutionResult = {
        planId: failedPlan.id,
        completed: false,
        status: 'failed',
        actionResults,
        startedAt,
        completedAt,
        error,
      }

      await this.eventBus.emit('behavior.execution.failed', {
        planId: failedPlan.id,
        plan: failedPlan,
        error,
      })

      this.logger?.error('behavior execution failed', error, {
        phase: 'behavior-execution',
        planId: failedPlan.id,
        stimulusId: failedPlan.stimulusId,
      })

      return result
    }
  }

  private async executeAction(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
  ): Promise<BehaviorExecutionActionResult> {
    const startedAt = Date.now()
    const running = cloneAction(action, 'running', startedAt)

    await this.eventBus.emit('behavior.execution.action.started', {
      planId: plan.id,
      actionId: running.id,
      action: running,
    })

    try {
      const result = await this.dispatch(plan, running, startedAt)
      const completedAt = Date.now()
      const completedAction = cloneAction(running, result.skipped ? 'skipped' : 'completed', completedAt)

      const finalResult: BehaviorExecutionActionResult = {
        ...result,
        completedAt,
      }

      await this.eventBus.emit('behavior.execution.action.completed', {
        planId: plan.id,
        actionId: completedAction.id,
        action: completedAction,
        result: finalResult,
      })

      return finalResult
    } catch (error) {
      const completedAt = Date.now()
      const failed = cloneAction(running, 'failed', completedAt, {
        lastError: error instanceof Error ? error.message : String(error),
      })

      await this.eventBus.emit('behavior.execution.action.failed', {
        planId: plan.id,
        actionId: failed.id,
        action: failed,
        error,
      })

      this.logger?.error('behavior execution action failed', error, {
        phase: 'behavior-execution',
        planId: plan.id,
        actionId: action.id,
        actionType: action.type,
      })

      return {
        planId: plan.id,
        actionId: action.id,
        type: action.type,
        completed: false,
        startedAt,
        completedAt,
        error,
      }
    }
  }

  private async dispatch(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
    startedAt: number,
  ): Promise<Omit<BehaviorExecutionActionResult, 'completedAt'>> {
    switch (action.type) {
      case 'dialogue':
        return this.dispatchDialogue(plan, action, startedAt)
      case 'memory-update':
        return this.dispatchMemoryUpdate(plan, action, startedAt)
      case 'bond-update':
        return this.dispatchBondUpdate(plan, action, startedAt)
      case 'homeostasis-update':
        return this.dispatchHomeostasisUpdate(plan, action, startedAt)
      case 'emit-event':
      case 'noop':
      default:
        return {
          planId: plan.id,
          actionId: action.id,
          type: action.type,
          completed: true,
          skipped: action.type === 'noop',
          startedAt,
          emittedEvent: action.type === 'noop' ? undefined : 'noop',
          metadata: action.metadata,
        }
    }
  }

  private async dispatchDialogue(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
    startedAt: number,
  ): Promise<Omit<BehaviorExecutionActionResult, 'completedAt'>> {
    const task = action.payload['task']
    if (!isDialogueTask(task)) {
      throw new Error('dialogue action missing valid task')
    }

    await this.eventBus.emit('dialogue.task.created', { task })

    return {
      planId: plan.id,
      actionId: action.id,
      type: action.type,
      completed: true,
      startedAt,
      emittedEvent: 'dialogue.task.created',
      metadata: action.metadata,
    }
  }

  private async dispatchMemoryUpdate(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
    startedAt: number,
  ): Promise<Omit<BehaviorExecutionActionResult, 'completedAt'>> {
    const request = action.payload['request'] as MemoryUpdateRequest
    // W3：memory-update 不再恒 completed——事件总线隔离 listener 错误
    // （emit 不向调用方冒泡），改在 emit 窗口内订阅本次 action 关联的
    // memory.update.failed（memory 服务 catch 里必发），失败时置为未完成。
    let failure: unknown
    const disposeFailureListener = this.eventBus.on('memory.update.failed', (payload) => {
      if (payload.planId === plan.id && payload.actionId === action.id) {
        failure = payload.error ?? new Error('memory update failed')
      }
    })
    try {
      await this.eventBus.emit('behavior.memory.update.requested', {
        request,
        planId: plan.id,
        actionId: action.id,
      })
    } finally {
      disposeFailureListener()
    }
    if (failure !== undefined) throw failure
    return {
      planId: plan.id,
      actionId: action.id,
      type: action.type,
      completed: true,
      startedAt,
      emittedEvent: 'behavior.memory.update.requested',
      metadata: action.metadata,
    }
  }

  private async dispatchBondUpdate(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
    startedAt: number,
  ): Promise<Omit<BehaviorExecutionActionResult, 'completedAt'>> {
    const request = action.payload['request'] as BondUpdateRequest
    await this.eventBus.emit('behavior.bond.update.requested', {
      request,
      planId: plan.id,
      actionId: action.id,
    })
    return {
      planId: plan.id,
      actionId: action.id,
      type: action.type,
      completed: true,
      startedAt,
      emittedEvent: 'behavior.bond.update.requested',
      metadata: action.metadata,
    }
  }

  private async dispatchHomeostasisUpdate(
    plan: BehaviorExecutionPlan,
    action: BehaviorExecutionAction,
    startedAt: number,
  ): Promise<Omit<BehaviorExecutionActionResult, 'completedAt'>> {
    const request = action.payload['request'] as HomeostasisUpdateRequest
    await this.eventBus.emit('behavior.homeostasis.update.requested', {
      request,
      planId: plan.id,
      actionId: action.id,
    })
    return {
      planId: plan.id,
      actionId: action.id,
      type: action.type,
      completed: true,
      startedAt,
      emittedEvent: 'behavior.homeostasis.update.requested',
      metadata: action.metadata,
    }
  }
}
