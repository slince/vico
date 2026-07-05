// @vico/agent - UI 流类型定义（镜像 AI SDK 的 UIMessageChunk）

/** 附加在流片段上的元数据 */
type ProviderMetadata = Record<string, Record<string, unknown>>;

// ── UIMessage ──

/** UI 消息部件联合类型（镜像 AI SDK 的 UIMessagePart） */
export type UIMessagePart =
  | { type: 'text'; text: string; state?: 'streaming' | 'done'; providerMetadata?: ProviderMetadata; }
  | { type: 'reasoning'; text: string; state?: 'streaming' | 'done'; providerMetadata?: ProviderMetadata;};

/**
 * UIMessage — 镜像 ai 包的 UIMessage 类型。
 * 与 Vercel AI SDK 的 UIMessage 保持兼容，供 Agent.stream/invoke 接受来自客户端的 UI 消息。
 */
export interface UIMessage<METADATA = unknown> {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  parts?: UIMessagePart[];
  createdAt?: Date;
  metadata?: METADATA;
}

/** Agent.stream/invoke 接受的消息类型：纯文本字符串或结构化 UIMessage */
export type UserMessage = string | UIMessage;

/**
 * UIStreamChunk — 镜像 ai 包的 UIMessageChunk。
 * 定义服务端与客户端（@assistant-ui/react）之间的 SSE 协议。
 * turn-stream.ts 实际只使用部分变体，但为向前兼容保留了完整定义。
 */
export type UIStreamChunk =
  // 消息生命周期
  | { type: 'start'; messageId?: string; messageMetadata?: unknown }
  | { type: 'finish'; finishReason?: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'; messageMetadata?: unknown }
  | { type: 'abort'; reason?: string }
  | { type: 'message-metadata'; messageMetadata: unknown }
  // 步骤生命周期
  | { type: 'start-step' }
  | { type: 'finish-step' }
  // 文本生命周期
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // 推理生命周期
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // 工具输入生命周期
  | { type: 'tool-input-start'; toolCallId: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  | { type: 'tool-input-error'; toolCallId: string; toolName: string; input: unknown; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  // 工具输出生命周期
  | { type: 'tool-output-available'; toolCallId: string; output: unknown; providerExecuted?: boolean; dynamic?: boolean; preliminary?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-denied'; toolCallId: string }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; signature?: string }
  // 来源
  | { type: 'source-url'; sourceId: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source-document'; sourceId: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // 文件
  | { type: 'file'; url: string; mediaType: string; providerMetadata?: ProviderMetadata }
  // 错误
  | { type: 'error'; errorText: string }
  // 数据（动态扩展，含 data-turn-paused 等自定义类型）
  | { type: `data-${string}`; id?: string; data: unknown; transient?: boolean };
