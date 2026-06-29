// @vico/agent - AgentLoop module type definitions
import type {ModelMessage} from '../model/types.js';
import type {Thread, Turn} from '../thread/types.js';

/** 工具审批决策 */
export interface ApprovalDecision {
  toolCallId: string;
  approved: boolean;
}

/** 模型引用 */
export interface ModelRef {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted' | 'paused';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
  /** 所属 turn ID */
  turnId?: string;
  /** 所属 thread ID */
  threadId?: string;
}

/** turn 暂停原因及恢复所需信息 */
export interface PauseInfo {
  /** 暂停原因 */
  reason: 'tool-approval' | 'error';
  /** 等待审批的工具调用 */
  pendingToolCalls: Array<{ id: string; name: string; args: unknown }>;
  /** 暂停时的 step 索引 */
  pausedAtStep: number;
  /** 暂停时 messages 数组长度（完整性校验） */
  messageCount: number;
}

/** 一次 turn 的会话标识，贯穿 model 调用和工具执行 */
export interface TurnSession {
  workspace: string;
  thread: Thread;
  turn: Turn;
}

/** runTurn 选项 */
export interface RunTurnOptions {
  /** 会话线程 ID，不传则自动生成 */
  threadId?: string;
  scopeId?: string;
  userId?: string;
  workspace?: string;
  /** 审批决策。若 thread 中存在 paused turn，runTurn 自动恢复执行 */
  approvalDecisions?: ApprovalDecision[];
}

// ── 核心领域模型：Thread > Turn > Step ──

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface Step {
  /** 当前步骤编号（0 起始） */
  index: number;
  /** 所属 thread */
  threadId: string;
  /** 执行作用域 */
  scopeId: string;
  /** 中断信号 */
  signal: AbortSignal;
}

/** turn 执行过程中的流式事件（仅用于 agent.on() 订阅） */
export type TurnEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step-start'; step: number }
  | { type: 'step-end'; step: number }
  | { type: 'compacted'; removedTokens: number }
  | { type: 'error'; error: string | Error }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'done'; usage: { input: number; output: number } };
