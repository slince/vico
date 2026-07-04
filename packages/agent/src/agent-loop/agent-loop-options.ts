import {UsageMetrics} from "./types.js";
import {ToolCall, ToolResult} from "../tool/types.js";
import {ModelRequestContext} from "./context-processors/context-processor.js";
import {TurnTrace} from "../observable/turn-tracer.js";
import {ModelMessage, ModelStreamChunk} from "../model/types.js";
import {Thread, Turn} from "../thread/types.js";

/** executeModelStep 的返回值 */
export interface ModelStepResult {
  /** 是否终止循环 */
  shouldBreak: boolean;
  /** 是否需要暂停等待外部审批 */
  shouldPause: boolean;
  /** 暂停信息（shouldPause 为 true 时需要） */
  pauseInfo?: PauseInfo;
  /** 本 step 的 token 用量 */
  usage: UsageMetrics;
  /** 本step是否执行出错*/
  error?: Error | string;
}

/** 审批分类结果 */
export interface ApprovalClassification {
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  pausedCalls: ToolCall[];
}

/** callModel 的返回值 */
export interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型请求的工具调用 */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: UsageMetrics;
  /** 错误信息（如有） */
  error?: string | Error;
}

/** executeModelStep / callModel 共享上下文 */
export interface TurnContext {
  ctx: ModelRequestContext
  messages: ModelMessage[]
  session: TurnSession;
  trace: TurnTrace;
  toolApprovalState: Map<string, boolean>;
  /** turn 级中断信号，贯穿 model 调用和工具执行 */
  signal: AbortSignal;
  /** 流控制器，用于向客户端推送 chunk */
  controller: ReadableStreamDefaultController<ModelStreamChunk>;
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
  pendingToolCalls: ToolCall[];
  /** 暂停时已自动批准的工具调用（恢复时直接执行，无需再次审批） */
  autoApprovedCalls?: ToolCall[];
  /** 暂停时已自动拒绝的工具结果（恢复时直接追加） */
  autoDeniedResults?: ToolResult[];
  /** 暂停时的 step 索引 */
  pausedAtStep: number;
  /** 暂停时 messages 数组长度（完整性校验） */
  messageCount: number;
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

/** 一次 turn 的会话标识，贯穿 model 调用和工具执行 */
export interface TurnSession {
  workspace?: string;
  thread: Thread;
  turn: Turn;
  scopeId?: string;
}


/** 客户端工具审批决策（将 toolCallId 与审批结果绑定） */
export interface ToolApproval {
  toolCallId: string;
  approved: boolean;
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