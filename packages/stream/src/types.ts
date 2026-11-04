// @vico/stream - 引擎输出流协议（Chunk）。
//
// 设计目标：彻底摆脱 ai 包的 TextStreamPart / UIMessage，用自有的「信封 + 判别联合」
// 报文协议（借鉴 mastra 的 ChunkType）作为引擎对外唯一输出契约：
//   { type, runId, payload }
// - `type` 为字面量判别字段；
// - `runId` 为本条 chunk 所属的 run（一次 stream() 调用）标识，供多 run / 恢复场景关联；
// - `payload` 的内容与 `type` 强绑定（各 type 有独立的 payload 接口）。
//
// 分层约定（与旧 TextStreamPart 时代一致）：
//   ModelClient 输出 provider 层协议（ModelStreamPart，@vico/model 别名，保留 @ai-sdk/provider）；
//   LoopAgent 将其转换为引擎层协议（Chunk）后对外输出；
//   UI 层（服务端路由）再转换为 UIMessageChunk（过渡）或 ag-ui 事件（目标态）。
import type {ModelMessage, ModelProviderMetadata} from '@vico/model';
import type {SharedV4Warning} from '@ai-sdk/provider';
import type {UsageMetrics} from '@vico/types';

/** JSON 值（可安全 JSON.stringify，供 SSE 序列化） */
export type JSONValue = null | string | number | boolean | JSONObject | JSONValue[];
export type JSONObject = { [key: string]: JSONValue };

/** provider 元数据别名（@ai-sdk/provider 的 SharedV4ProviderMetadata，跨包统一入口） */
export type ProviderMetadata = ModelProviderMetadata;

// ─────────────────────────────────────────────────────────────────────────────
// 公共信封
// ─────────────────────────────────────────────────────────────────────────────

/** 工具调用 payload 公共形态（tool-call / tool-approval-request / tool-approval-response 复用） */
export interface ToolCallPayload {
  /** 工具调用 ID（provider 生成，贯穿调用与结果配对） */
  toolCallId: string;
  /** 工具名 */
  toolName: string;
  /** 工具入参（JSON 对象） */
  input: unknown;
  /** 是否由 provider 端执行 */
  providerExecuted?: boolean;
  /** input JSON 解析失败等无效调用标记 */
  invalid?: boolean;
  /** 无效调用的原始错误（序列化为 string） */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 各 type 对应的 payload
// ─────────────────────────────────────────────────────────────────────────────

/** 流开始（无负载，仅作生命周期信号） */
export interface StartPayload {}

/** 文本块开始 */
export interface TextStartPayload {
  id: string;
  providerMetadata?: ProviderMetadata;
}

/** 文本增量 */
export interface TextDeltaPayload {
  id: string;
  text: string;
  providerMetadata?: ProviderMetadata;
}

/** 文本块结束 */
export interface TextEndPayload {
  id: string;
  providerMetadata?: ProviderMetadata;
}

/** 推理块开始 */
export interface ReasoningStartPayload {
  id: string;
  providerMetadata?: ProviderMetadata;
}

/** 推理增量 */
export interface ReasoningDeltaPayload {
  id: string;
  text: string;
  providerMetadata?: ProviderMetadata;
}

/** 推理块结束 */
export interface ReasoningEndPayload {
  id: string;
  providerMetadata?: ProviderMetadata;
}

/** 工具输入流式开始 */
export interface ToolInputStartPayload {
  toolCallId: string;
  toolName: string;
  providerExecuted?: boolean;
  providerMetadata?: ProviderMetadata;
}

/** 工具输入流式增量 */
export interface ToolInputDeltaPayload {
  toolCallId: string;
  delta: string;
  providerMetadata?: ProviderMetadata;
}

/** 工具输入流式结束 */
export interface ToolInputEndPayload {
  toolCallId: string;
  providerMetadata?: ProviderMetadata;
}

/** 工具执行结果（成功） */
export interface ToolResultPayload {
  toolCallId: string;
  toolName: string;
  /** 对应工具调用的入参（tool-result/tool-error part 要求携带） */
  input?: unknown;
  /** 工具输出（JSON 安全） */
  output: unknown;
  providerExecuted?: boolean;
  /** provider 端初步结果标记 */
  preliminary?: boolean;
  providerMetadata?: ProviderMetadata;
}

/** 工具执行错误 */
export interface ToolErrorPayload {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  /** 错误信息（序列化为 string） */
  error: string;
  providerExecuted?: boolean;
  providerMetadata?: ProviderMetadata;
}

/** 工具输出被拒绝（策略 / 审批拒绝） */
export interface ToolOutputDeniedPayload {
  toolCallId: string;
  toolName: string;
}

/** 审批请求（approvalId 复用 toolCallId，客户端审批响应可直接映射） */
export interface ToolApprovalRequestPayload {
  approvalId: string;
  toolCall: ToolCallPayload;
}

/** 审批决策结果（恢复执行时回放决策） */
export interface ToolApprovalResponsePayload {
  approvalId: string;
  toolCall: ToolCallPayload;
  approved: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/** 生成文件（data 为 base64 / URL 字符串，按 `https?://` 前缀识别外链） */
export interface FilePayload {
  data: string;
  mediaType: string;
  providerMetadata?: ProviderMetadata;
}

/** 引用来源 */
export type SourcePayload =
  | { sourceType: 'url'; id: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { sourceType: 'document'; id: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata };

/** 自定义 provider 内容（透传） */
export interface CustomPayload {
  kind: string;
  providerMetadata?: ProviderMetadata;
}

/** 原始 provider 事件（透传） */
export interface RawPayload {
  raw: unknown;
}

/** step 开始（携带本步输入消息与 warnings） */
export interface StartStepPayload {
  request: { messages: ModelMessage[] };
  warnings: SharedV4Warning[];
}

/** step 性能指标（由 finishStepPart 按时间戳计算） */
export interface StepPerformance {
  /** 本 step 模型调用总耗时（ms） */
  stepTimeMs: number;
  /** 首个输出 chunk 到达耗时（ms，无输出时为 undefined） */
  timeToFirstOutputMs?: number;
  /** 有效输出 token 速率（outputTokens / 秒） */
  effectiveOutputTokensPerSecond: number;
  /** 有效总 token 速率（totalTokens / 秒） */
  effectiveTotalTokensPerSecond: number;
}

/** step 结束（携带 response / usage / performance / finishReason） */
export interface FinishStepPayload {
  response: { id: string; modelId: string; timestamp: string };
  usage: UsageMetrics;
  performance: StepPerformance;
  finishReason: string;
  rawFinishReason?: string;
  providerMetadata?: ProviderMetadata;
}

/** 扁平化语言模型用量（finish 终态的 totalUsage，供 UI 兼容展示） */
export interface TotalUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** turn 终态 finish */
export interface FinishPayload {
  finishReason: string;
  rawFinishReason?: string;
  totalUsage: TotalUsage;
  /** 完整 UsageMetrics（路由层挂到消息 metadata，供前端展示明细） */
  usage: UsageMetrics;
}

/** 错误 */
export interface ErrorPayload {
  error: string;
}

/** 中止（无负载，仅作生命周期信号） */
export interface AbortPayload {}

// ─────────────────────────────────────────────────────────────────────────────
// 引擎层输出协议（平替 TextStreamPart<TToolSet>，去掉 TOOLS 泛型，改为 JSON 安全）
// ─────────────────────────────────────────────────────────────────────────────

/** 公共信封：所有 payload chunk 携带的 run 标识 */
export interface BaseChunkType {
  runId: string;
}

/** 自定义数据通道（无 runId/payload，透传任意结构化数据给前端） */
export type DataChunkType = {
  type: `data-${string}`;
  data: unknown;
  id?: string;
  /** true 时仅流给客户端、不持久化到存储 */
  transient?: boolean;
};

export type ChunkType =
  | (BaseChunkType & { type: 'start'; payload: StartPayload })
  | (BaseChunkType & { type: 'text-start'; payload: TextStartPayload })
  | (BaseChunkType & { type: 'text-delta'; payload: TextDeltaPayload })
  | (BaseChunkType & { type: 'text-end'; payload: TextEndPayload })
  | (BaseChunkType & { type: 'reasoning-start'; payload: ReasoningStartPayload })
  | (BaseChunkType & { type: 'reasoning-delta'; payload: ReasoningDeltaPayload })
  | (BaseChunkType & { type: 'reasoning-end'; payload: ReasoningEndPayload })
  | (BaseChunkType & { type: 'tool-input-start'; payload: ToolInputStartPayload })
  | (BaseChunkType & { type: 'tool-input-delta'; payload: ToolInputDeltaPayload })
  | (BaseChunkType & { type: 'tool-input-end'; payload: ToolInputEndPayload })
  | (BaseChunkType & { type: 'tool-call'; payload: ToolCallPayload })
  | (BaseChunkType & { type: 'tool-result'; payload: ToolResultPayload })
  | (BaseChunkType & { type: 'tool-error'; payload: ToolErrorPayload })
  | (BaseChunkType & { type: 'tool-output-denied'; payload: ToolOutputDeniedPayload })
  | (BaseChunkType & { type: 'tool-approval-request'; payload: ToolApprovalRequestPayload })
  | (BaseChunkType & { type: 'tool-approval-response'; payload: ToolApprovalResponsePayload })
  | (BaseChunkType & { type: 'file'; payload: FilePayload })
  | (BaseChunkType & { type: 'reasoning-file'; payload: FilePayload })
  | (BaseChunkType & { type: 'source'; payload: SourcePayload })
  | (BaseChunkType & { type: 'custom'; payload: CustomPayload })
  | (BaseChunkType & { type: 'raw'; payload: RawPayload })
  | (BaseChunkType & { type: 'start-step'; payload: StartStepPayload })
  | (BaseChunkType & { type: 'finish-step'; payload: FinishStepPayload })
  | (BaseChunkType & { type: 'finish'; payload: FinishPayload })
  | (BaseChunkType & { type: 'error'; payload: ErrorPayload })
  | (BaseChunkType & { type: 'abort'; payload: AbortPayload })
  | DataChunkType;

/** Chunk 类型字面量联合 */
export type ChunkKind = ChunkType['type'];

/** 未携带 runId 的 payload chunk 草稿（part 构造函数的返回形态，由 run 边界统一盖章 runId） */
export type ChunkDraft = Omit<Exclude<ChunkType, DataChunkType>, 'runId'>;

/**
 * 给 payload chunk 草稿盖章 runId，产出完整 ChunkType。
 *
 * @param runId - 本次 stream() 调用的 run 标识
 * @param draft - payload chunk 草稿（{ type, payload }）
 * @returns 完整 ChunkType（DataChunkType 不经过本函数）
 */
export function stampRunId(runId: string, draft: ChunkDraft): ChunkType {
  return { ...draft, runId } as ChunkType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent 输入消息类型（保留 ModelMessage，废弃 UIMessage）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent.stream / invoke 接受的消息类型：
 * - `string` — 纯文本，转为单条 user 消息
 * - `ModelMessage[]` — 原生模型消息组，原样作为本轮输入（调用方全权控制，如 few-shot、预置上下文）
 */
export type UserMessage = string | ModelMessage[];
