// @vico/agent - ToolHost port interface: tool discovery and execution
import type { ToolSpec, ToolCall, ToolResult } from '../contracts/tool.js';
import type { HookRunner } from '../hook/hook-types.js';

/** 工具执行上下文 */
export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  workspace: string;
  awaitApproval: (call: ToolCall) => Promise<ApprovalDecision>;
  hooks: HookRunner[];
  signal: AbortSignal;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

/** 工具系统端口 */
export interface ToolHost {
  listTools(context: ToolExecutionContext): Promise<ToolSpec[]>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
  executeBatch(calls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]>;
}
