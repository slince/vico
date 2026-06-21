// @vico/agent - Tool module type definitions
import type { ToolSpec, ToolCall, ToolResult } from '../contracts/tool.js';
import type { HookRunner } from '../hook/hook-runner.js';
import type { AgentLoop } from '../agent-loop/agent-loop.js';

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

/** 工具系统端口 */
export interface ToolHost {
  listTools(context: ToolExecutionContext): Promise<ToolSpec[]>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
  executeBatch(calls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]>;
  /** 动态注册工具处理器（覆盖已有同名 handler） */
  registerHandler(name: string, handler: ToolHandler): void;
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
