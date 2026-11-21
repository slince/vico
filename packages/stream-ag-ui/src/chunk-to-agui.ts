// @vico/stream-ag-ui - 引擎 Chunk 流 → ag-ui 事件流适配器。
//
// 引擎只产出 ChunkType（{ type, runId, payload }）；本模块将其转换为 ag-ui 协议事件，
// 经 SSE 返回给前端。审批门禁用 ag-ui interrupts 表达：
//   tool-approval-request → 记录 interrupt，finish 时以 RUN_FINISHED{outcome:'interrupt'} 收尾；
//   恢复时前端经 RunAgentInput.resume 回传决议，由 model-messages 还原为 tool-approval-response。
import {randomUUID} from 'node:crypto';
import {type Event, EventType, type Interrupt, type TokenUsage} from '@ag-ui/core';
import type {ChunkType} from '@vico/stream';
import type {UsageMetrics} from '@vico/types';
import {toolApprovalInterrupt} from './interrupts.js';

/**
 * 创建 ChunkType → ag-ui Event 的 TransformStream。
 *
 * 调用方自行把引擎 ChunkType 流 pipeThrough 本变换流，得到 ag-ui Event 流。
 *
 * @param opts.threadId - 会话线程 ID（RUN_STARTED / RUN_FINISHED 携带）
 * @param opts.runId - 本次 run 标识（RUN_STARTED / RUN_FINISHED 携带）
 * @returns ChunkType → Event 的变换流
 */
export function createChunkToAgUiTransformer(opts: {
  threadId: string;
  runId: string;
}): TransformStream<ChunkType, Event> {
  const { threadId, runId } = opts;

  // 当前 step 的 assistant 消息 id：一个 step（一次模型调用）对应一条 assistant 消息，
  // 审批/续跑会在同一 turn 内产生多个 step，不能整个 run 共用一条消息 id
  let stepMessageId = randomUUID();
  // 审批门禁：收集 tool-approval-request，finish 时以 interrupt outcome 收尾
  const interrupts: Interrupt[] = [];
  // 终态状态：aborted / errored / finished（避免重复发终态事件）
  let aborted = false;
  let errored = false;
  let errorMessage: string | undefined;
  let finished = false;
  // 已由 tool-input-* 三段表达过的工具调用：provider 对同一次调用既会流式发参数，
  // 也会在生成完毕后补一条 tool-call 汇总，不做去重会让前端收到两次 TOOL_CALL_START
  const streamedInputIds = new Set<string>();
  const completedInputIds = new Set<string>();

  return new TransformStream<ChunkType, Event>({
    transform(chunk, enqueue) {
      switch (chunk.type) {
        case 'start':
          enqueue.enqueue({
            type: EventType.RUN_STARTED,
            threadId,
            runId,
            // turn 归属经 metadata 透传：前端据此把实时 assistant 消息关联到所属 turn
            metadata: { turnId: chunk.payload.turnId },
          });
          break;

        case 'start-step':
          // 每个 step 开启一条新的 assistant 消息（同一 turn 内多 step 不可共用 messageId）
          stepMessageId = randomUUID();
          enqueue.enqueue({ type: EventType.STEP_STARTED, stepName: `step-${chunk.payload.stepIndex}` });
          break;

        case 'finish-step':
          enqueue.enqueue({
            type: EventType.STEP_FINISHED,
            stepName: `step-${chunk.payload.stepIndex}`,
            // 完成原因（end / pause / error）经 metadata 透传，前端据此区分 step 结束态
            metadata: { reason: chunk.payload.reason },
          });
          break;

        case 'text-start':
          enqueue.enqueue({
            type: EventType.TEXT_MESSAGE_START,
            messageId: stepMessageId,
          });
          break;
        case 'text-delta':
          enqueue.enqueue({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: stepMessageId, delta: chunk.payload.text });
          break;
        case 'text-end':
          enqueue.enqueue({ type: EventType.TEXT_MESSAGE_END, messageId: stepMessageId });
          break;

        case 'reasoning-start':
          enqueue.enqueue({
            type: EventType.REASONING_MESSAGE_START,
            messageId: chunk.payload.id,
            role: 'reasoning',
          });
          break;
        case 'reasoning-delta':
          enqueue.enqueue({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: chunk.payload.id, delta: chunk.payload.text });
          break;
        case 'reasoning-end':
          enqueue.enqueue({ type: EventType.REASONING_MESSAGE_END, messageId: chunk.payload.id });
          break;

        case 'tool-input-start':
          streamedInputIds.add(chunk.payload.toolCallId);
          enqueue.enqueue({ type: EventType.TOOL_CALL_START, toolCallId: chunk.payload.toolCallId, toolCallName: chunk.payload.toolName, parentMessageId: stepMessageId });
          break;
        case 'tool-input-delta':
          enqueue.enqueue({ type: EventType.TOOL_CALL_ARGS, toolCallId: chunk.payload.toolCallId, delta: chunk.payload.delta });
          break;
        case 'tool-input-end':
          completedInputIds.add(chunk.payload.toolCallId);
          enqueue.enqueue({ type: EventType.TOOL_CALL_END, toolCallId: chunk.payload.toolCallId });
          break;

        case 'tool-call': {
          const toolCallId = chunk.payload.toolCallId;
          // 流式三段已完整送达时，这条调用在 AG-UI 侧已表达完毕，汇总事件只用于兜底
          if (completedInputIds.has(toolCallId)) break;
          // 已发过 START 但没收到 END（参数流被截断）：不再补 START，只补完整参数与 END
          if (!streamedInputIds.has(toolCallId)) {
            enqueue.enqueue({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: chunk.payload.toolName, parentMessageId: stepMessageId });
          }
          enqueue.enqueue({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(chunk.payload.input) });
          enqueue.enqueue({ type: EventType.TOOL_CALL_END, toolCallId });
          completedInputIds.add(toolCallId);
          break;
        }

        case 'tool-result':
          enqueue.enqueue({
            type: EventType.TOOL_CALL_RESULT,
            messageId: randomUUID(),
            toolCallId: chunk.payload.toolCallId,
            content: typeof chunk.payload.output === 'string' ? chunk.payload.output : JSON.stringify(chunk.payload.output),
            role: 'tool',
          });
          break;

        case 'tool-error':
          enqueue.enqueue({
            type: EventType.TOOL_CALL_RESULT,
            messageId: randomUUID(),
            toolCallId: chunk.payload.toolCallId,
            content: chunk.payload.error,
            role: 'tool',
          });
          break;

        case 'tool-output-denied':
          enqueue.enqueue({
            type: EventType.TOOL_CALL_RESULT,
            messageId: randomUUID(),
            toolCallId: chunk.payload.toolCallId,
            content: 'Tool execution denied',
            role: 'tool',
          });
          break;

        // 审批门禁：暂停 turn，等待用户决议（决议经 resume 回传）
        case 'tool-approval-request':
          interrupts.push(toolApprovalInterrupt(
            chunk.payload.approvalId,
            chunk.payload.toolCall.toolCallId,
            chunk.payload.toolCall.toolName,
            chunk.payload.toolCall.input,
          ));
          break;

        // 恢复执行时回放的审批决策：仅作信息透传（前端不直接消费）
        case 'tool-approval-response':
          break;

        case 'file':
        case 'reasoning-file':
        case 'source':
        case 'custom':
        case 'raw':
          // 当前前端无专门渲染，经 CUSTOM 保底透出
          enqueue.enqueue({
            type: EventType.CUSTOM,
            name: chunk.type,
            value: chunk.payload,
          });
          break;

        case 'error':
          errored = true;
          errorMessage = chunk.payload.error;
          break;

        case 'abort':
          aborted = true;
          break;

        case 'finish': {
          if (finished) break;
          finished = true;
          if (errored) {
            enqueue.enqueue({ type: EventType.RUN_ERROR, message: errorMessage ?? 'Unknown error' });
          } else if (interrupts.length > 0) {
            enqueue.enqueue({
              type: EventType.RUN_FINISHED,
              threadId,
              runId,
              outcome: { type: 'interrupt', interrupts },
            });
          } else {
            enqueue.enqueue({
              type: EventType.RUN_FINISHED,
              threadId,
              runId,
              outcome: aborted ? { type: 'cancelled' } : { type: 'success' },
              usage: [toTokenUsage(chunk.payload.usage)],
            });
          }
          break;
        }

        default:
          // data-* 自定义数据通道 → CUSTOM 事件
          enqueue.enqueue({
            type: EventType.CUSTOM,
            name: chunk.type.slice('data-'.length),
            value: chunk.data,
          });
          break;
      }
    },

    flush(enqueue) {
      // 流异常截断（未发终态）时兜底 RUN_ERROR
      if (!finished && !errored) {
        enqueue.enqueue({ type: EventType.RUN_ERROR, message: 'Run ended unexpectedly' });
      }
    },
  });
}

/**
 * UsageMetrics → ag-ui TokenUsage（总量口径）。
 *
 * @param usage - 引擎 finish 终态携带的完整用量明细（@vico/types）
 * @returns ag-ui 协议的 TokenUsage
 */
export function toTokenUsage(usage: UsageMetrics): TokenUsage {
  return {
    inputTokens: usage.inputTokens.total,
    outputTokens: usage.outputTokens.total,
    totalTokens: (usage.inputTokens.total ?? 0) + (usage.outputTokens.total ?? 0),
    reasoningTokens: usage.outputTokens.reasoning,
    cachedInputTokens: usage.inputTokens.cacheRead,
    cacheWriteInputTokens: usage.inputTokens.cacheWrite,
  };
}
