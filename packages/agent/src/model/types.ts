// @vico/agent - Model module type definitions
import type { Tool } from '../tool/types.js';
import type { ModelRef } from '../agent-loop/types.js';

/** ModelClient 工厂 — 从模型引用创建 ModelClient 实例 */
export type ModelClientFactory = (ref: ModelRef) => ModelClient;

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 标准化消息格式 */
export interface ModelMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

/** LLM 请求 */
export interface ModelRequest {
  system?: string;
  messages: ModelMessage[];
  tools: Tool[];
  maxTokens?: number;
  temperature?: number;
  abortSignal: AbortSignal;
}

/** 标准化流式块 — 屏蔽 AI SDK 版本差异 */
export type ModelStreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_delta'; id: string; name: string; args: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number }
  | { type: 'completed'; finishReason: string }
  | { type: 'error'; message: string };

/** 模型客户端端口 — 封装 LLM 调用 */
export interface ModelClient {
  readonly provider: string;
  readonly model: string;

  /** 流式调用 LLM，返回标准化 chunk 迭代器 */
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
