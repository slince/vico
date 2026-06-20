import type { Message } from './agent.js';

/**
 * ModelClient — LLM 调用抽象端口。
 * 封装底层 AI SDK / HTTP 客户端，提供统一的流式调用接口。
 */
export interface ModelClient {
  /** Provider 标识（如 "openai", "anthropic"） */
  readonly provider: string;
  /** 模型名称（如 "gpt-4o"） */
  readonly model: string;

  /**
   * 流式调用 LLM。
   * 返回 AsyncIterable，每个 chunk 是标准化的 ModelStreamChunk。
   */
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

/**
 * 发送给 LLM 的请求结构。
 */
export interface ModelRequest {
  /** 系统提示词（不可变前缀部分） */
  system?: string;
  /** 动态上下文指令（每步可变，放在 history 之后） */
  contextInstructions?: string[];
  /** 对话消息列表 */
  messages: ModelMessage[];
  /** 可用工具定义列表 */
  tools: ToolSpec[];
  /** 最大输出 Token */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** 推理力度 */
  reasoningEffort?: string;
  /** 取消信号 */
  abortSignal: AbortSignal;
}

/**
 * 标准化模型消息 — 框架内部统一格式。
 */
export interface ModelMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具规格定义（JSON Schema 格式）。
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * 标准化流式 chunk 类型。
 * 屏蔽不同 LLM Provider 的 chunk 格式差异。
 */
export type ModelStreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_delta'; id: string; name: string; args: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number }
  | { type: 'completed'; finishReason: string }
  | { type: 'error'; message: string };
