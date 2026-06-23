// @vico/agent - Model module type definitions

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

// ── ModelClient types ──

/** Provider metadata — keyed by provider name */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/** Warning from provider */
export type StreamWarning = {
  type: 'unsupported' | 'compatibility' | 'other';
  feature?: string;
  message?: string;
};

/** Token usage snapshot */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Tool shape ModelClient accepts */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** ModelClient.stream() options */
export interface ModelCallOptions {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolDescriptor[];
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() return */
export interface ModelStreamResult {
  stream: AsyncGenerator<ModelStreamChunk>;
}

/**
 * ModelStreamChunk — complete mirror of LanguageModelV3StreamPart.
 * Every variant mapped 1:1; only tool-call.input parsed from string to unknown.
 */
export type ModelStreamChunk =
  // Text lifecycle
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // Reasoning lifecycle
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool input lifecycle
  | { type: 'tool-input-start'; id: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'tool-input-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool call (aggregated, input parsed)
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // Tool result (from provider)
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean; preliminary?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata }
  // Tool approval request
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; providerMetadata?: ProviderMetadata }
  // File
  | { type: 'file'; mediaType: string; data: string | Uint8Array; providerMetadata?: ProviderMetadata }
  // Source (discriminated by sourceType)
  | { type: 'source'; sourceType: 'url'; id: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source'; sourceType: 'document'; id: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // Metadata
  | { type: 'stream-start'; warnings: StreamWarning[] }
  | { type: 'response-metadata'; id?: string; timestamp?: Date; modelId?: string }
  | { type: 'finish'; finishReason: string; rawFinishReason?: string; usage: ModelUsage; providerMetadata?: ProviderMetadata }
  | { type: 'raw'; rawValue: unknown }
  | { type: 'error'; message: string };
