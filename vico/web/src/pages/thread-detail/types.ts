/**
 * Shared types for the thread-detail page and its sub-components.
 */
import type { ContentPart } from '@vico/core';

/**
 * Shape of a single tool-call entry stored as a JSON string on the message.
 * Each entry records the tool name, its arguments, and the invocation result.
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/** Message content 可能是旧格式（纯文本字符串）或新格式（native parts 数组） */
export type MessageContent = string | ContentPart[];

/** Shape of a message returned inside the thread detail payload */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
  tool_calls?: string; // JSON-serialised ToolCall[]
  created_at: string;
}

/** Shape returned by GET /threads/:id */
export interface ThreadDetail {
  id: string;
  agent_id: string;
  agent_name?: string;
  model_name: string;
  message_count: number;
  messages: Message[];
}

/** Props for the {@link ToolCallSection} component. */
export interface ToolCallSectionProps {
  /** Raw JSON string containing the serialised tool calls */
  toolCallsRaw: string;
}

/** Props for the {@link MessageBubble} component. */
export interface MessageBubbleProps {
  /** The message object to render */
  message: Message;
}
