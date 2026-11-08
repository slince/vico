// @vico/stream - createModelStreamTransformer: 将 provider 原生 V4 流转换为引擎层 ChunkType 的 TransformStream
import type {ModelStreamPart} from '@vico/model';
import type {ToolCall} from '@vico/tool';
import {createToolCall, v4FilePart, v4ToolResultPart} from './stream-parts.js';
import {stampRunId, type ChunkType, type CustomPayload, type RawPayload, type SourcePayload} from './types.js';

/**
 * 创建 V4 → 引擎层 ChunkType 的 TransformStream。
 *
 * 转换逻辑（V4 → 引擎层协议映射）内聚在 transform 回调中；文本 / 推理 / 工具调用 / usage 的
 * 累积仍由 BufferedModelStream 完成，调用方 pipeThrough 后消费输出流，再经 result.result() 取回完整结果。
 * step 级边界（start-step / finish-step）不在此层发，由 LoopAgent.runLoop 统一发（覆盖 LLM + 工具执行）。
 *
 * 从 LoopAgent.callModel 中抽出，使 V4 → 引擎层协议的映射逻辑独立成函数，
 * callModel 仅负责组装请求、获取流，并将流 pipeThrough 本转换器后转发。
 *
 * @param runId - 本次 stream() 调用的 run 标识（盖章到每条 chunk）
 * @returns provider 原生 V4 part → 引擎层 ChunkType 的转换流
 */
export function createModelStreamTransformer(
  runId: string,
): TransformStream<ModelStreamPart, ChunkType> {
  /** toolCallId → ToolCall，供 provider 端 tool-result / tool-approval-request 关联 input */
  const callsById = new Map<string, ToolCall>();

  return new TransformStream<ModelStreamPart, ChunkType>({
    transform(chunk, controller) {
      switch (chunk.type) {
        // ── 同形透传（重建对象以对齐引擎层类型）──
        case 'text-start':
          controller.enqueue(stampRunId(runId, { type: 'text-start', payload: { id: chunk.id, providerMetadata: chunk.providerMetadata } }));
          break;
        case 'text-end':
          controller.enqueue(stampRunId(runId, { type: 'text-end', payload: { id: chunk.id, providerMetadata: chunk.providerMetadata } }));
          break;
        case 'reasoning-start':
          controller.enqueue(stampRunId(runId, { type: 'reasoning-start', payload: { id: chunk.id, providerMetadata: chunk.providerMetadata } }));
          break;
        case 'reasoning-end':
          controller.enqueue(stampRunId(runId, { type: 'reasoning-end', payload: { id: chunk.id, providerMetadata: chunk.providerMetadata } }));
          break;

        // ── 文本/推理 delta：V4 的 delta 字段 → ChunkType 的 text 字段 ──
        case 'text-delta':
          controller.enqueue(stampRunId(runId, { type: 'text-delta', payload: { id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata } }));
          break;

        case 'reasoning-delta':
          controller.enqueue(stampRunId(runId, { type: 'reasoning-delta', payload: { id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata } }));
          break;

        // ── 工具输入流式（同形透传）──
        case 'tool-input-start':
          controller.enqueue(stampRunId(runId, { type: 'tool-input-start', payload: { toolCallId: chunk.id, toolName: chunk.toolName, providerExecuted: chunk.providerExecuted, providerMetadata: chunk.providerMetadata } }));
          break;
        case 'tool-input-delta':
          controller.enqueue(stampRunId(runId, { type: 'tool-input-delta', payload: { toolCallId: chunk.id, delta: chunk.delta, providerMetadata: chunk.providerMetadata } }));
          break;
        case 'tool-input-end':
          controller.enqueue(stampRunId(runId, { type: 'tool-input-end', payload: { toolCallId: chunk.id, providerMetadata: chunk.providerMetadata } }));
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
          controller.enqueue(stampRunId(runId, {
            type: 'tool-call',
            payload: createToolCall(call, { providerExecuted: chunk.providerExecuted, invalid, error: parseError }),
          }));
          break;
        }

        // ── provider 端执行的工具结果：isError 分流 tool-result / tool-error ──
        case 'tool-result':
          controller.enqueue(stampRunId(runId, v4ToolResultPart(chunk, callsById.get(chunk.toolCallId)?.args)));
          break;

        // ── provider 端审批请求：关联已记录的 toolCall（查不到则合成占位调用）──
        case 'tool-approval-request': {
          const call = callsById.get(chunk.toolCallId) ?? { id: chunk.toolCallId, name: 'unknown', args: {} };
          controller.enqueue(stampRunId(runId, {
            type: 'tool-approval-request',
            payload: { approvalId: chunk.approvalId, toolCall: createToolCall(call, { providerExecuted: true }) },
          }));
          break;
        }

        // ── 文件：V4 data/url 变体 → FilePayload ──
        case 'file':
        case 'reasoning-file':
          controller.enqueue(stampRunId(runId, v4FilePart(chunk)));
          break;

        // ── 来源引用 → SourcePayload ──
        case 'source': {
          const payload: SourcePayload = chunk.sourceType === 'url'
            ? { sourceType: 'url', id: chunk.id, url: chunk.url, title: chunk.title, providerMetadata: chunk.providerMetadata }
            : { sourceType: 'document', id: chunk.id, mediaType: chunk.mediaType, title: chunk.title, filename: chunk.filename, providerMetadata: chunk.providerMetadata };
          controller.enqueue(stampRunId(runId, { type: 'source', payload }));
          break;
        }

        // ── 自定义 provider 内容 → CustomPayload ──
        case 'custom': {
          const payload: CustomPayload = { kind: chunk.kind, providerMetadata: chunk.providerMetadata };
          controller.enqueue(stampRunId(runId, { type: 'custom', payload }));
          break;
        }

        // ── 原始 provider 事件 → RawPayload ──
        case 'raw': {
          const payload: RawPayload = { raw: chunk.rawValue };
          controller.enqueue(stampRunId(runId, { type: 'raw', payload }));
          break;
        }

        // ── V4 finish：单次模型调用结束；不对外发 part（step 级 finish-step 由 runLoop 统一发）──
        case 'finish':
          break;

        case 'error': {
          const err = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
          controller.enqueue(stampRunId(runId, { type: 'error', payload: { error: err } }));
          break;
        }
      }
    },
  });
}
