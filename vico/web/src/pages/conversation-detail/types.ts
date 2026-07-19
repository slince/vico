/**
 * Shared types for the conversation-detail page and its sub-components.
 */

/**
 * Shape of a single tool-call entry stored as a JSON string on the message.
 * Each entry records the tool name, its arguments, and the invocation result.
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/** AI SDK 原生的 content part 类型（reasoning / text） */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  providerOptions?: Record<string, unknown>;
}

export interface TextPart {
  type: 'text';
  text: string;
  providerOptions?: Record<string, unknown>;
}

/** Message content 可能是旧格式（纯文本字符串）或新格式（native parts 数组） */
export type MessageContent = string | Array<ReasoningPart | TextPart | { type: string; [key: string]: unknown }>;

/** Shape of a message returned inside the conversation detail payload */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
  tool_calls?: string; // JSON-serialised ToolCall[]
  created_at: string;
}

/** Shape returned by GET /conversations/:id */
export interface ConversationDetail {
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
