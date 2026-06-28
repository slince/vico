// @vico/agent - 模型模块类型定义
import type {LanguageModelV3FinishReason, LanguageModelV3Usage} from '@ai-sdk/provider';

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
}

// ── ModelClient 类型 ──

/** Provider 元数据 — 按 provider 名称索引 */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/** Provider 发出的警告 */
export type StreamWarning = {
  type: 'unsupported' | 'compatibility' | 'other';
  feature?: string;
  message?: string;
};

/** ModelClient 接受的工具格式 */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** ModelClient.stream() 调用参数 */
export interface ModelRequest {
  system: string;
  messages: ReadonlyArray<ModelMessage>;
  tools: ReadonlyArray<ToolDescriptor>;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() 返回值 */
export interface ModelStreamResult {
  stream: AsyncGenerator<ModelStreamChunk>;
}

/**
 * ModelStreamChunk — 映射 LanguageModelV3StreamPart 的所有变体。
 * 仅 tool-call.input 从 JSON 字符串解析为 unknown，其余字段与 SDK 一致。
 */
export type ModelStreamChunk =
  // 文本生命周期
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // 推理生命周期
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // 工具输入生命周期
  | { type: 'tool-input-start'; id: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-end'; id: string; providerMetadata?: ProviderMetadata }
  // 工具调用（input 已解析）
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // 工具结果（来自 provider）
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean; preliminary?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // 工具审批请求（provider 发出或 Vico policy 触发）
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; toolName: string; input: unknown; providerMetadata?: ProviderMetadata }
  // 工具审批被拒
  | { type: 'tool-output-denied'; toolCallId: string; toolName: string; reason?: string }
  // 文件
  | { type: 'file'; mediaType: string; data: string | Uint8Array; providerMetadata?: ProviderMetadata }
  // 来源（按 sourceType 区分）
  | { type: 'source'; sourceType: 'url'; id: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source'; sourceType: 'document'; id: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // 元数据
  | { type: 'stream-start'; warnings: StreamWarning[] }
  | { type: 'response-metadata'; id?: string; timestamp?: Date; modelId?: string }
  | { type: 'finish'; finishReason: LanguageModelV3FinishReason; usage: LanguageModelV3Usage; providerMetadata?: ProviderMetadata }
  | { type: 'raw'; rawValue: unknown }
  | { type: 'error'; error: unknown }
  // turn 暂停（agent-loop 触发）
  | { type: 'turn-paused'; reason: string; turnId: string };
