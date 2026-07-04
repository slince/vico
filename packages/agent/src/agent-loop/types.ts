// @vico/agent - AgentLoop module type definitions
import type {ModelMessage} from '../model/types.js';
import type {Thread, Turn} from '../thread/types.js';

/** 客户端工具审批决策（将 toolCallId 与审批结果绑定） */
export interface ToolApproval {
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

/** Token 用量统计 */
export interface UsageMetrics {
  input: number;
  output: number;
}

/** runStepLoop 返回的 loop 执行结果 */
export interface StepLoopResult {
  finalStatus: 'completed' | 'aborted' | 'paused' | 'failed';
  steps: number;
  usage: UsageMetrics;
  error?: Error | string;
}

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted' | 'paused';
  steps: number;
  usage: UsageMetrics;
  messages: ModelMessage[];
  /** 所属 turn ID */
  turnId?: string;
  /** 所属 thread ID */
  threadId?: string;
  /** 错误信息（status 为 failed 时） */
  error?: Error | string;
}

/** turn 暂停原因及恢复所需信息 */
export interface PauseInfo {
  /** 暂停原因 */
  reason: 'tool-approval' | 'error';
  /** 等待审批的工具调用 */
  pendingToolCalls: Array<{ id: string; name: string; args: unknown }>;
  /** 暂停时已自动批准的工具调用（恢复时直接执行，无需再次审批） */
  autoApprovedCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** 暂停时已自动拒绝的工具结果（恢复时直接追加） */
  autoDeniedResults?: Array<{ callId: string; name: string; error: Error|string }>;
  /** 暂停时的 step 索引 */
  pausedAtStep: number;
  /** 暂停时 messages 数组长度（完整性校验） */
  messageCount: number;
}

/** 一次 turn 的会话标识，贯穿 model 调用和工具执行 */
export interface TurnSession {
  workspace?: string;
  thread: Thread;
  turn: Turn;
  scopeId?: string;
}

/** runTurn 选项 */
export interface RunOptions {
  /** 会话线程 ID，不传则自动生成 */
  threadId?: string;
  scopeId?: string;
  userId?: string;
  workspace?: string;
  /** 自定义元数据（JSON 可序列化），写入 thread.metadata */
  metadata?: Record<string, unknown>;
  /** 审批决策。若 thread 中存在 paused turn，runTurn 自动恢复执行 */
  approvalDecisions?: ToolApproval[];
}

// ── 核心领域模型：Thread > Turn > Step ──

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface Step {
  /** 当前步骤编号（0 起始） */
  index: number;

  /** 本轮step的会话*/
  messages: ModelMessage[]
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
  | { type: 'done'; usage: UsageMetrics };
