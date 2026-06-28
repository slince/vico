// @vico/agent - Tool module type definitions
import type {z} from 'zod';

import type {TurnSession} from '../agent-loop/types.js';

/** 工具审批策略 */
export type ToolPolicy = 'auto' | 'on-request' | 'suggest' | 'never';

/** 工具类别 */
export type ToolKind = 'readonly' | 'command' | 'file_change' | 'delegate' | 'mutation';

/** 工具 — 规格定义 + 执行逻辑 */
export interface Tool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  /** Zod 参数 schema，用于校验和生成 JSON Schema */
  inputSchema: z.ZodType<TInput, any>;
  /** Zod 输出 schema（可选），用于输出校验 */
  outputSchema?: z.ZodType<TOutput, any>;
  policy: ToolPolicy;
  kind: ToolKind;
  /** 来源标签（如 "builtin", "skill", "agent:xxx"） */
  tags: string[];
  /** 执行工具调用 */
  execute(call: ToolCall<TInput>, ctx: ToolExecutionContext): Promise<TOutput>;
}

/** LLM 返回的工具调用 */
export interface ToolCall<TInput = any> {
  id: string;
  name: string;
  args: TInput;
}

/** 工具执行结果 */
export interface ToolResult<TOutput = unknown> {
  callId: string;
  name: string;
  status: 'success' | 'error';
  output: TOutput;
  error?: string | Error;
}

/** 工具执行上下文 */
export interface ToolExecutionContext {
  session: TurnSession;
  agentId: string;
  awaitApproval: (call: ToolCall) => Promise<ApprovalDecision>;
  signal: AbortSignal;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

/** 审批策略上下文 */
export interface PolicyContext {
  firstUse: boolean;
  previousApproved: boolean;
}

