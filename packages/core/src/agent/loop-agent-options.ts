import {UsageMetrics} from "./types.js";
import {ToolCall, ToolResult} from "../tool/types.js";
import type {Checkpoint} from "./checkpoint.js";
import {ModelRequestContext} from "./context-processors/model-request-context.js";
import type {ModelMessage, TextStreamPart, ToolSet} from 'ai';
import {Thread, Turn} from "../thread/thread-store.js";

/** executeModelStep 返回值 */
export interface ModelStepResult {
  /** 步骤执行后的动作：break=终止循环, pause=暂停等待审批, continue=继续下一步 */
  action: 'break' | 'pause' | 'continue';
  /** 待审批的 ToolCall（action 为 pause 时需要） */
  pendingApprovalCalls?: ToolCall[];
  /** 本轮审批通过待执行的调用（pause：恢复时差集补跑；continue：执行前落「计划版本」清单） */
  approvedCalls?: ToolCall[];
  /** 本轮被拒绝的结果（pause：恢复时落库；continue：随执行结果一并落库） */
  deniedResults?: ToolResult[];
  /** 本 step 的 token 用量 */
  usage: UsageMetrics;
  /** 本step是否执行出错*/
  error?: Error | string;
}

/** 审批处置结果（通过 / 拒绝 / 待审批三组） */
export interface ResolvedApprovals {
  /** 审批通过、待执行的工具调用 */
  approvedCalls: ToolCall[];
  /** 审批拒绝的调用所对应的结果（error 形式，随执行结果一并落库） */
  deniedResults: ToolResult[];
  /** 待审批的 ToolCall（需暂停 turn 等待客户端审批） */
  pendingApprovalCalls: ToolCall[];
}

/** callModel 的返回值 */
export interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型推理/思考内容（reasoning tokens，如 o1/DeepSeek-R1 的内部推理链） */
  reasoning?: string;
  /** 模型请求的工具调用 */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: UsageMetrics;
  /** 错误信息（如有） */
  error?: string | Error;
}

/** executeModelStep / callModel 共享上下文 */
export interface TurnContext<TToolSet extends ToolSet = ToolSet> {
  ctx: ModelRequestContext
  messages: ModelMessage[]
  session: TurnSession;
  approvedTools: Map<string, ToolApproval>;
  /** turn 级中断信号，贯穿 model 调用和工具执行 */
  signal: AbortSignal;
  /** 流控制器，用于向客户端推送 chunk（引擎层协议 TextStreamPart） */
  controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  /** 本 turn 的 checkpoint 对象（startTurn/resumeTurn 创建，append-only 版本链：step 完成 / pause / 终态时由 loop-agent append 新版本） */
  checkpoint: Checkpoint;
}


/** runStepLoop 返回的 loop 执行结果 */
export interface StepLoopResult {
  status: 'completed' | 'aborted' | 'paused' | 'failed';
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
  /** 所属 thread（status 为 failed 且发生在 thread 创建前时为 undefined） */
  thread?: Thread;
  /** 所属 turn（status 为 failed 且发生在 turn 创建前时为 undefined） */
  turn?: Turn;
  /** 错误信息（status 为 failed 时） */
  error?: Error | string;
}

// ── 核心领域模型：Thread > Turn > Step ──

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface TurnStep {
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
}


/** 客户端工具审批决策（将 toolCallId 与审批结果绑定） */
export interface ToolCallApproval {
  toolCallId: string;
  approved: boolean;
  /** 审批作用域：turn（本 turn 有效）| session（整个 thread 有效），默认 turn */
  scope?: 'turn' | 'session';
}

/** 单次工具审批在 turn 内的状态记录 */
export interface ToolApproval {
  /** 是否已批准 */
  approved: boolean;
  /** 批准/拒绝时间戳（Unix ms） */
  approvedAt: number;
}

/** runTurn 选项 */
export interface RunOptions {
  /** 会话线程对象（必传，通过 agent.createThread() 创建） */
  thread: Thread;
}