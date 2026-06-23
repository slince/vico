// @vico/agent - UI stream type definitions (mirror of AI SDK UIMessageChunk)

/** Metadata attached to stream chunks */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/**
 * UIStreamChunk — mirror of ai package's UIMessageChunk.
 * Defines the SSE protocol between server and client (@assistant-ui/react).
 * Only the variants actually used by turn-stream.ts are needed, but the full
 * set is defined for forward compatibility.
 */
export type UIStreamChunk =
  // Message lifecycle
  | { type: 'start'; messageId?: string; messageMetadata?: unknown }
  | { type: 'finish'; finishReason?: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'; messageMetadata?: unknown }
  | { type: 'abort'; reason?: string }
  | { type: 'message-metadata'; messageMetadata: unknown }
  // Step lifecycle
  | { type: 'start-step' }
  | { type: 'finish-step' }
  // Text lifecycle
  | { type: 'text-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderMetadata }
  // Reasoning lifecycle
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderMetadata }
  // Tool input lifecycle
  | { type: 'tool-input-start'; toolCallId: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean; title?: string; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  | { type: 'tool-input-error'; toolCallId: string; toolName: string; input: unknown; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown>; title?: string }
  // Tool output lifecycle
  | { type: 'tool-output-available'; toolCallId: string; output: unknown; providerExecuted?: boolean; dynamic?: boolean; preliminary?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string; providerExecuted?: boolean; dynamic?: boolean; providerMetadata?: ProviderMetadata; toolMetadata?: Record<string, unknown> }
  | { type: 'tool-output-denied'; toolCallId: string }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; signature?: string }
  // Sources
  | { type: 'source-url'; sourceId: string; url: string; title?: string; providerMetadata?: ProviderMetadata }
  | { type: 'source-document'; sourceId: string; mediaType: string; title: string; filename?: string; providerMetadata?: ProviderMetadata }
  // File
  | { type: 'file'; url: string; mediaType: string; providerMetadata?: ProviderMetadata }
  // Error
  | { type: 'error'; errorText: string }
  // Data (dynamic extension)
  | { type: `data-${string}`; id?: string; data: unknown; transient?: boolean };
