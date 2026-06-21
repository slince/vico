// @vico/agent - Tool module type definitions
import { z } from 'zod';
import type { HookRunner } from '../hook/hook-runner.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';

/** 工具审批策略 */
export const ToolPolicySchema = z.enum(['auto', 'on-request', 'suggest', 'never']);
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/** 工具类别 */
export const ToolKindSchema = z.enum(['readonly', 'command', 'file_change', 'delegate', 'mutation']);
export type ToolKind = z.infer<typeof ToolKindSchema>;

/** 工具规格定义（发给 LLM 的 tool description） */
export const ToolSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  policy: ToolPolicySchema.default('auto'),
  kind: ToolKindSchema.default('readonly'),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

/** LLM 返回的工具调用 */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** 工具执行结果 */
export const ToolResultSchema = z.object({
  callId: z.string(),
  name: z.string(),
  status: z.enum(['success', 'error']),
  output: z.unknown(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** 工具执行上下文 */
export interface ToolExecutionContext {
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

/** 工具存储端口 — 加载工具列表 */
export interface ToolStore {
  load(): Promise<ToolSpec[]>;
}

/** 工具执行处理器 */
export interface ToolHandler {
  execute(call: ToolCall, ctx: ToolExecutionContext): Promise<unknown>;
}

/** 工具来源 — 提供工具列表和对应处理器 */
export interface ToolSource {
  name: string;
  list(ctx: ToolExecutionContext): Promise<ToolSpec[]>;
  getHandler(name: string): ToolHandler | undefined;
}

/** 审批策略上下文 */
export interface PolicyContext {
  firstUse: boolean;
  previousApproved: boolean;
}

/** 子 Agent 委托策略 */
export type DelegateStrategy = 'readonly' | 'inherit';

/** 子 Agent 引用 */
export interface ChildAgentRef {
  /** 子 Agent 标识 */
  agentId: string;
  /** 子 Agent 的 AgentLoop 实例 */
  loop: AgentLoop;
}
