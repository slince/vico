// @vico/stream - LoopAgent 输出流协议（Chunk）的 part 构造与 V4 映射辅助
//
// 分层约定：ModelClient 输出 provider 层协议（ModelStreamPart，见 @vico/model 别名），
// LoopAgent 将其转换为引擎层协议（Chunk）后对外输出，
// UI 层再转换为 UIMessageChunk（过渡）或 ag-ui 事件（目标态）。本模块承载引擎层 part 的构造逻辑。
import type {ModelFile, ModelReasoningFile, ModelToolResult} from '@vico/model';
import type {ToolCall, ToolResult} from '@vico/tool';
import type {UsageMetrics} from '@vico/types';
import {addTokenCount} from './usage.js';
import type {
  ChunkDraft,
  FilePayload,
  FinishPayload,
  ToolCallPayload,
  ToolResultPayload,
  ToolErrorPayload,
} from './types.js';

/** 终态 finish 的结束原因（对齐 provider unified finish reason） */
export type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other';

/** createToolCall 的可选属性 */
interface ToolCallPartOptions {
  /** 是否由 provider 执行（provider 端工具） */
  providerExecuted?: boolean;
  /** input JSON 解析失败等无效调用标记 */
  invalid?: boolean;
  /** 无效调用的原始错误 */
  error?: unknown;
}

/** 将错误序列化为 string（Error → message，其余 String 兜底） */
function toErrorString(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

/**
 * 将 Vico ToolCall 转为引擎层 ToolCallPayload。
 * 供 tool-call part 及 tool-approval-request/response 的 toolCall 字段复用。
 */
export function createToolCall(call: ToolCall, opts?: ToolCallPartOptions): ToolCallPayload {
  return {
    toolCallId: call.id,
    toolName: call.name,
    input: call.args,
    providerExecuted: opts?.providerExecuted,
    invalid: opts?.invalid,
    error: opts?.error != null ? toErrorString(opts.error) : undefined,
  };
}

/**
 * 本地（引擎侧）工具执行结果 part：success → tool-result，error → tool-error。
 *
 * @param result - ToolExecutor 的执行结果
 * @param input - 对应工具调用的入参（tool-result/tool-error part 要求携带）
 */
export function toolResultPart(result: ToolResult, input: unknown): ChunkDraft {
  if (result.status === 'success') {
    const payload: ToolResultPayload = { toolCallId: result.callId, toolName: result.name, input, output: result.output };
    return { type: 'tool-result', payload };
  }
  const payload: ToolErrorPayload = { toolCallId: result.callId, toolName: result.name, input, error: toErrorString(result.error) };
  return { type: 'tool-error', payload };
}

/**
 * provider 端执行的工具结果（V4 tool-result chunk）→ tool-result / tool-error part。
 *
 * @param chunk - V4 tool-result chunk
 * @param input - 由先前 tool-call 记录的入参（V4 tool-result 不携带 input）
 */
export function v4ToolResultPart(chunk: ModelToolResult, input: unknown): ChunkDraft {
  if (chunk.isError) {
    const payload: ToolErrorPayload = {
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      input,
      error: toErrorString(chunk.result),
      providerExecuted: true,
      providerMetadata: chunk.providerMetadata,
    };
    return { type: 'tool-error', payload };
  }
  const payload: ToolResultPayload = {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    input,
    output: chunk.result,
    providerExecuted: true,
    preliminary: chunk.preliminary,
    providerMetadata: chunk.providerMetadata,
  };
  return { type: 'tool-result', payload };
}

/** 工具被拒绝（策略/用户审批拒绝）part */
export function toolOutputDeniedPart(call: ToolCall): ChunkDraft {
  return { type: 'tool-output-denied', payload: { toolCallId: call.id, toolName: call.name } };
}

/** 引擎审批请求 part（approvalId 复用 toolCallId，客户端审批响应可直接映射） */
export function toolApprovalRequestPart(call: ToolCall): ChunkDraft {
  return { type: 'tool-approval-request', payload: { approvalId: call.id, toolCall: createToolCall(call) } };
}

/** 审批决策结果 part（恢复执行时回放决策） */
export function toolApprovalResponsePart(
  call: ToolCall,
  approved: boolean,
  opts?: { reason?: string; scope?: 'turn' | 'session' },
): ChunkDraft {
  return { type: 'tool-approval-response', payload: { approvalId: call.id, toolCall: createToolCall(call), approved, ...opts } };
}

/**
 * V4 file / reasoning-file chunk → 引擎层 file part。
 * data 变体直接携带字节/base64；url 变体与 ai core 行为一致——将 URL 字符串存入 data 字段
 * （下游按 `https?://` 前缀识别为外链）。
 */
export function v4FilePart(chunk: ModelFile | ModelReasoningFile): ChunkDraft {
  const raw = chunk.data.type === 'data' ? chunk.data.data : chunk.data.url.toString();
  // Uint8Array 转 base64，保证 payload JSON 安全
  const data = typeof raw === 'string' ? raw : Buffer.from(raw).toString('base64');
  const payload: FilePayload = { data, mediaType: chunk.mediaType, providerMetadata: chunk.providerMetadata };
  return { type: chunk.type, payload };
}

/** step 开始 part：携带本步序号（step 边界现由 runLoop 统一发，覆盖 LLM + 工具执行） */
export function startStepPart(stepIndex: number): ChunkDraft {
  return { type: 'start-step', payload: { stepIndex } };
}

/** step 结束 part：携带本步序号与本步模型调用累计用量（工具执行完 / 终态答案后由 runLoop 发） */
export function finishStepPart(stepIndex: number, usage: UsageMetrics): ChunkDraft {
  return { type: 'finish-step', payload: { stepIndex, usage } };
}

/**
 * turn 终态 finish part。totalUsage 由 UsageMetrics 派生（仅填充总量）供 UI 兼容，
 * 完整 UsageMetrics 另经 usage 字段透出，供路由层 messageMetadata 挂到消息 metadata。
 * 精确的分步 usage 已由各 finish-step part 携带。
 */
export function finishPart(finishReason: FinishReason, usage: UsageMetrics): ChunkDraft {
  const payload: FinishPayload = {
    finishReason,
    totalUsage: {
      inputTokens: usage.inputTokens.total,
      outputTokens: usage.outputTokens.total,
      totalTokens: addTokenCount(usage.inputTokens.total, usage.outputTokens.total),
    },
    usage,
  };
  return { type: 'finish', payload };
}
