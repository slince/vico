// @vico/stream - createModelStreamTransformer: 将 provider 原生 V4 流转换为引擎层 TextStreamPart 的 TransformStream
import type {CallWarning, TextStreamPart, ToolSet} from 'ai';

import type {ToolCall} from '@vico/tool';
import {createToolCall, finishStepPart, startStepPart, v4FilePart, v4ToolResultPart,} from './stream-parts.js';
import type {ModelRequest, ModelStreamPart} from '@vico/model';

/**
 * 创建 V4 → 引擎层 TextStreamPart 的 TransformStream。
 *
 * 转换逻辑（V4 → 引擎层协议映射）与 step 级状态（start-step / response-metadata / finish-step）
 * 内聚在 transform 回调中；文本 / 推理 / 工具调用 / usage 的累积仍由 BufferedModelStream 完成，
 * 调用方 pipeThrough 后消费输出流，再经 result.result() 取回完整结果。
 *
 * 从 LoopAgent.callModel 中抽出，使 V4 → 引擎层协议的映射逻辑独立成函数，
 * callModel 仅负责组装请求、获取流，并将流 pipeThrough 本转换器后转发。
 *
 * @param request - 本 step 模型请求（供 start-step part 携带 request）
 * @returns provider 原生 V4 part → 引擎层 TextStreamPart 的转换流
 */
export function createModelStreamTransformer<TToolSet extends ToolSet = ToolSet>(
  request: ModelRequest,
): TransformStream<ModelStreamPart, TextStreamPart<TToolSet>> {
  // ── V4 → TextStreamPart 转换所需的 step 级状态 ──
  const stepStartTime = Date.now();
  /** 首个输出 chunk 到达时间（性能指标 timeToFirstOutputMs） */
  let firstChunkTime: number | undefined;
  /** start-step 是否已发出（stream-start 携带 warnings；未收到时由首个内容 part 兜底触发） */
  let stepStarted = false;
  /** 从 V4 response-metadata 捕获，进 finish-step.response */
  let responseMeta: { id?: string; modelId?: string; timestamp?: Date } = {};
  /** toolCallId → ToolCall，供 provider 端 tool-result / tool-approval-request 关联 input */
  const callsById = new Map<string, ToolCall>();

  /** start-step 兜底：stream-start 时携带 warnings 触发，其余 part 到达前无 warnings 兜底触发 */
  const ensureStepStarted = (
    controller: TransformStreamDefaultController<TextStreamPart<TToolSet>>,
    warnings: CallWarning[] = [],
  ): void => {
    if (stepStarted) return;
    stepStarted = true;
    controller.enqueue(startStepPart(request.messages, warnings));
  };

  return new TransformStream<ModelStreamPart, TextStreamPart<TToolSet>>({
    transform(chunk, controller) {
      // stream-start 携带 warnings → start-step；不对外透出 stream-start 本身
      if (chunk.type === 'stream-start') {
        ensureStepStarted(controller, chunk.warnings);
        return;
      }
      ensureStepStarted(controller);

      switch (chunk.type) {
        // ── 同形透传（重建对象以对齐引擎层类型）──
        case 'text-start':
        case 'text-end':
        case 'reasoning-start':
        case 'reasoning-end':
          controller.enqueue(chunk);
          break;

        // ── 文本/推理 delta：V4 的 delta 字段 → TextStreamPart 的 text 字段 ──
        case 'text-delta':
          firstChunkTime ??= Date.now();
          controller.enqueue({ type: 'text-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
          break;

        case 'reasoning-delta':
          firstChunkTime ??= Date.now();
          controller.enqueue({ type: 'reasoning-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
          break;

        // ── 工具输入流式（同形透传）──
        case 'tool-input-start':
        case 'tool-input-delta':
        case 'tool-input-end':
          controller.enqueue(chunk);
          break;

        case 'tool-call': {
          // V4 tool-call 的 input 为 JSON 字符串，解析失败时兜底空对象并以 invalid 标记
          let args: Record<string, unknown>;
          let invalid = false;
          let parseError: unknown;
          try {
            args = chunk.input ? JSON.parse(chunk.input) as Record<string, unknown> : {};
          } catch (e) {
            args = {};
            invalid = true;
            parseError = e;
          }
          const call: ToolCall = { id: chunk.toolCallId, name: chunk.toolName, args };
          callsById.set(call.id, call);
          controller.enqueue(createToolCall(call, { providerExecuted: chunk.providerExecuted, invalid, error: parseError }));
          break;
        }

        // ── provider 端执行的工具结果：isError 分流 tool-result / tool-error ──
        case 'tool-result':
          controller.enqueue(v4ToolResultPart(chunk, callsById.get(chunk.toolCallId)?.args));
          break;

        // ── provider 端审批请求：关联已记录的 toolCall（查不到则合成占位调用）──
        case 'tool-approval-request': {
          const call = callsById.get(chunk.toolCallId) ?? { id: chunk.toolCallId, name: 'unknown', args: {} };
          controller.enqueue({ type: 'tool-approval-request', approvalId: chunk.approvalId, toolCall: createToolCall(call, { providerExecuted: true }) });
          break;
        }

        // ── 文件：V4 data/url 变体 → GeneratedFile ──
        case 'file':
        case 'reasoning-file':
          controller.enqueue(v4FilePart(chunk));
          break;

        // ── 同形透传：Source = LanguageModelV4Source ──
        case 'source':
        case 'custom':
        case 'raw':
          controller.enqueue(chunk);
          break;

        // ── 响应元数据：捕获进 finish-step.response ──
        case 'response-metadata':
          responseMeta = { id: chunk.id, modelId: chunk.modelId, timestamp: chunk.timestamp };
          break;

        // ── V4 finish（单次调用级）→ finish-step（携带 response/usage/performance）──
        case 'finish':
          controller.enqueue(finishStepPart({
            usage: chunk.usage,
            finishReason: chunk.finishReason,
            providerMetadata: chunk.providerMetadata,
            response: responseMeta,
            startTime: stepStartTime,
            firstChunkTime,
          }));
          break;

        case 'error': {
          const err = chunk.error instanceof Error ? chunk.error : String(chunk.error);
          controller.enqueue({ type: 'error', error: err });
          break;
        }
      }
    },
  });
}
