// @vico/core - AgentLoop 输出流协议（TextStreamPart）的 part 构造与 V4 映射辅助
import type {
  CallWarning,
  FinishReason,
  ModelMessage,
  StepResultPerformance,
  TextStreamPart,
  ToolSet,
  TypedToolCall
} from 'ai';
//
// 分层约定：ModelClient 输出 provider 层协议（LanguageModelV4StreamPart），
// AgentLoop 将其转换为引擎层协议（TextStreamPart<TToolSet>）后对外输出，
// turn-stream 再转换为 UI 层协议（UIMessageChunk）。本模块承载引擎层 part 的构造逻辑。
import {DefaultGeneratedFile} from 'ai';
import {asLanguageModelUsage, createNullLanguageModelUsage} from 'ai/internal';
import type {
  LanguageModelV4File,
  LanguageModelV4FinishReason,
  LanguageModelV4ReasoningFile,
  LanguageModelV4ToolResult,
  LanguageModelV4Usage,
  SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {UsageMetrics} from './types.js';

/** createToolCall 的可选属性 */
interface ToolCallPartOptions {
  /** 是否由 provider 执行（provider 端工具） */
  providerExecuted?: boolean;
  /** input JSON 解析失败等无效调用标记 */
  invalid?: boolean;
  /** 无效调用的原始错误 */
  error?: unknown;
}

/**
 * 将 Vico ToolCall 转为 AI SDK 的 ToolCall 形态。
 * 供 tool-call part 及 tool-approval-request/response 的 toolCall 字段复用。
 *
 * Vico 工具由 Agent 构造时确定，运行时固定，因此标记 `dynamic: false`。
 */
export function createToolCall<TToolSet extends ToolSet = ToolSet>(call: ToolCall, opts?: ToolCallPartOptions): TypedToolCall<TToolSet> {
  return {
    type: 'tool-call',
    toolCallId: call.id,
    toolName: call.name,
    input: call.args,
    dynamic: false,
    providerExecuted: opts?.providerExecuted,
    invalid: opts?.invalid,
    error: opts?.error,
  } as TypedToolCall<TToolSet>;
}

/**
 * 本地（引擎侧）工具执行结果 part：success → tool-result，error → tool-error。
 *
 * @param result - ToolExecutor 的执行结果
 * @param input - 对应工具调用的入参（tool-result/tool-error part 要求携带）
 */
export function toolResultPart<TToolSet extends ToolSet = ToolSet>(result: ToolResult, input: unknown): TextStreamPart<TToolSet> {
  if (result.status === 'success') {
    return {
      type: 'tool-result',
      toolCallId: result.callId,
      toolName: result.name,
      input,
      output: result.output,
      dynamic: false,
    } as TextStreamPart<TToolSet>;
  }
  return {
    type: 'tool-error',
    toolCallId: result.callId,
    toolName: result.name,
    input,
    error: result.error,
    dynamic: false,
  } as TextStreamPart<TToolSet>;
}

/**
 * provider 端执行的工具结果（V4 tool-result chunk）→ tool-result / tool-error part。
 *
 * @param chunk - V4 tool-result chunk
 * @param input - 由先前 tool-call 记录的入参（V4 tool-result 不携带 input）
 */
export function v4ToolResultPart<TToolSet extends ToolSet = ToolSet>(chunk: LanguageModelV4ToolResult, input: unknown): TextStreamPart<TToolSet> {
  if (chunk.isError) {
    return {
      type: 'tool-error',
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      input,
      error: chunk.result,
      providerExecuted: true,
      dynamic: false,
      providerMetadata: chunk.providerMetadata,
    } as TextStreamPart<TToolSet>;
  }
  return {
    type: 'tool-result',
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    input,
    output: chunk.result,
    providerExecuted: true,
    dynamic: false,
    preliminary: chunk.preliminary,
    providerMetadata: chunk.providerMetadata,
  } as TextStreamPart<TToolSet>;
}

/** 工具被拒绝（策略/用户审批拒绝）part */
export function toolOutputDeniedPart<TToolSet extends ToolSet = ToolSet>(call: ToolCall): TextStreamPart<TToolSet> {
  return { type: 'tool-output-denied', toolCallId: call.id, toolName: call.name } as TextStreamPart<TToolSet>;
}

/** 引擎审批请求 part（approvalId 复用 toolCallId，客户端审批响应可直接映射） */
export function toolApprovalRequestPart<TToolSet extends ToolSet = ToolSet>(call: ToolCall): TextStreamPart<TToolSet> {
  return { type: 'tool-approval-request', approvalId: call.id, toolCall: createToolCall<TToolSet>(call) } as TextStreamPart<TToolSet>;
}

/** 审批决策结果 part（恢复执行时回放决策） */
export function toolApprovalResponsePart<TToolSet extends ToolSet = ToolSet>(call: ToolCall, approved: boolean, reason?: string): TextStreamPart<TToolSet> {
  return { type: 'tool-approval-response', approvalId: call.id, toolCall: createToolCall<TToolSet>(call), approved, reason } as TextStreamPart<TToolSet>;
}

/**
 * V4 file / reasoning-file chunk → 引擎层 file part。
 * data 变体直接携带字节/base64；url 变体与 ai core 行为一致——将 URL 字符串存入 data 字段
 * （下游按 `https?://` 前缀识别为外链）。
 */
export function v4FilePart<TToolSet extends ToolSet = ToolSet>(chunk: LanguageModelV4File | LanguageModelV4ReasoningFile): TextStreamPart<TToolSet> {
  const data = chunk.data.type === 'data' ? chunk.data.data : chunk.data.url.toString();
  return {
    type: chunk.type,
    file: new DefaultGeneratedFile({ data, mediaType: chunk.mediaType }),
    providerMetadata: chunk.providerMetadata,
  } as TextStreamPart<TToolSet>;
}

/** step 开始 part（request 携带本步输入消息，warnings 来自 V4 stream-start） */
export function startStepPart<TToolSet extends ToolSet = ToolSet>(messages: ModelMessage[], warnings: CallWarning[] = []): TextStreamPart<TToolSet> {
  return { type: 'start-step', request: { messages }, warnings } as TextStreamPart<TToolSet>;
}

/** finishStepPart 参数 */
export interface FinishStepParams {
  /** V4 finish chunk 的原始 usage */
  usage: LanguageModelV4Usage;
  /** V4 finish chunk 的结束原因（unified + raw） */
  finishReason: LanguageModelV4FinishReason;
  providerMetadata?: SharedV4ProviderMetadata;
  /** 从 V4 response-metadata chunk 捕获的响应元数据 */
  response: { id?: string; modelId?: string; timestamp?: Date };
  /** 本 step 模型调用开始时间戳（ms） */
  startTime: number;
  /** 首个输出 chunk 到达时间戳（ms），未产生输出时为 undefined */
  firstChunkTime?: number;
}

/** step 结束 part：V4 finish + response-metadata → finish-step（usage 转扁平结构，性能指标按时间戳计算） */
export function finishStepPart<TToolSet extends ToolSet = ToolSet>(params: FinishStepParams): TextStreamPart<TToolSet> {
  const usage = asLanguageModelUsage(params.usage);
  const now = Date.now();
  const stepTimeMs = now - params.startTime;
  const seconds = stepTimeMs / 1000;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + outputTokens;

  const performance: StepResultPerformance = {
    effectiveOutputTokensPerSecond: seconds > 0 ? outputTokens / seconds : 0,
    effectiveTotalTokensPerSecond: seconds > 0 ? totalTokens / seconds : 0,
    outputTokensPerSecond: undefined,
    inputTokensPerSecond: undefined,
    stepTimeMs,
    responseTimeMs: stepTimeMs,
    toolExecutionMs: {},
    timeToFirstOutputMs: params.firstChunkTime !== undefined ? params.firstChunkTime - params.startTime : undefined,
  };

  return {
    type: 'finish-step',
    response: {
      id: params.response.id ?? `resp-${params.startTime}`,
      modelId: params.response.modelId ?? 'unknown',
      timestamp: params.response.timestamp ?? new Date(),
    },
    usage,
    performance,
    finishReason: params.finishReason.unified,
    rawFinishReason: params.finishReason.raw,
    providerMetadata: params.providerMetadata,
  } as TextStreamPart<TToolSet>;
}

/**
 * turn 终态 finish part。totalUsage 由 UsageMetrics 派生（仅填充总量），
 * 精确的分步 usage 已由各 finish-step part 携带。
 */
export function finishPart<TToolSet extends ToolSet = ToolSet>(finishReason: FinishReason, usage: UsageMetrics): TextStreamPart<TToolSet> {
  return {
    type: 'finish',
    finishReason,
    rawFinishReason: undefined,
    totalUsage: {
      ...createNullLanguageModelUsage(),
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.input + usage.output,
    },
  } as TextStreamPart<TToolSet>;
}
