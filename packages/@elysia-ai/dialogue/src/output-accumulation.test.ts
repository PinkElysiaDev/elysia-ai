import { describe, expect, it } from 'vitest'
import type {
  BehaviorExecutionInstruction,
  BrainService,
  CoreEventMap,
  PerceptionResult,
} from '@elysia-ai/core'
import { NS_BEHAVIOR, NS_DIALOGUE_OUTPUT, ELYSIA_PIPELINE_STAGES, PipelineRunner, createRequestContext } from '@elysia-ai/core'
import { MemoryEventBus } from '@elysia-ai/core'
import { createDialoguePluginRuntime } from './index.js'

/**
 * Phase 43（P2）验收：dialogue 钩子装配在生命段上下文累积输出（NS_DIALOGUE_OUTPUT），
 * sender 阶段据此消费；事件发射保持不变。
 */

function makeBrain(reply: string): BrainService {
  return {
    async execute() {
      return { output: reply, messages: [] }
    },
  }
}

describe('dialogue 钩子装配的输出累积', () => {
  it('instruction 经 dialogue 阶段执行后，输出写入 NS_DIALOGUE_OUTPUT 且 dialogue.output.created 照发', async () => {
    const eventBus = new MemoryEventBus<CoreEventMap>()
    const runner = new PipelineRunner<unknown>()
    for (const stage of ELYSIA_PIPELINE_STAGES) {
      runner.registerStage(stage)
    }
    const events: string[] = []
    eventBus.onAny((event) => events.push(event))

    const runtime = createDialoguePluginRuntime({
      runtime: {
        context: { eventBus, pipeline: runner },
        conversationStore: undefined,
      },
      brain: makeBrain('钩子回复'),
      config: { enabled: true, memoryLimit: 10 },
      logger: { info() {}, debug() {}, warn() {}, error() {} },
    })
    void runtime

    const instruction: BehaviorExecutionInstruction = {
      stimulusId: 'stim-1',
      lifeId: 'life-1',
      actions: [{
        type: 'dialogue',
        task: {
          scope: { type: 'user', key: 'user-1' },
          sourceStimulusIds: ['stim-1'],
          mode: 'reply-now',
          messages: [],
          metadata: {},
        },
      } as never],
      createdAt: Date.now(),
    } as unknown as BehaviorExecutionInstruction

    const pctx = createRequestContext({
      id: 'stim-1:life-1',
      core: { stimulus: { id: 'stim-1' }, lifeId: 'life-1', routing: { lifeIds: ['life-1'] } },
    })
    pctx.write(NS_BEHAVIOR, instruction)
    pctx.write('perception', { intent: {} } as unknown as PerceptionResult)

    await runner.run(pctx, { stages: ['dialogue'] })

    const outputs = pctx.read<CoreEventMap['dialogue.output.created'][]>(NS_DIALOGUE_OUTPUT)
    expect(outputs).toHaveLength(1)
    expect(outputs![0].content).toBe('钩子回复')
    expect(events).toContain('dialogue.output.created')
    expect(events).toContain('dialogue.completed')
  })
})
