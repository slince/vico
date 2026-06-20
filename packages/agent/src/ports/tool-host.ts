import type { ToolSpec } from './model-client.js';

/**
 * 工具审批策略。
 */
export type ToolPolicy = 'auto' | 'on-request' | 'suggest' | 'never';

/**
 * 工具完整定义（扩展 ModelClient 的 ToolSpec，增加执行层属性）。
 */
export interface ToolDef extends ToolSpec {
  /** 审批策略 */
  policy: ToolPolicy;
  /** 工具类型（影响并行执行策略） */
  kind: 'readonly' | 'command' | 'file_change' | 'delegate';
}

/**
 * 工具调用请求。
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果。
 */
export interface ToolResult {
  callId: string;
  output: string;
  isError?: boolean;
}

/**
 * 工具执行上下文。
 */
export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  workspace?: string;
  signal: AbortSignal;
}

/**
 * ToolHost — 工具系统抽象端口。
 * 负责工具的发现、过滤、审批、执行全流程。
 */
export interface ToolHost {
  /** 列出当前上下文可用的工具定义 */
  listTools(context: ToolExecutionContext): Promise<ToolDef[]>;

  /** 执行单个工具调用 */
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;

  /** 批量执行（支持并行） */
  executeBatch(calls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]>;
}
