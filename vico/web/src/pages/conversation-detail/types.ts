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

/** Shape of a message returned inside the conversation detail payload */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
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
