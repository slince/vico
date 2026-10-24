import type {ToolApproval, ToolCallApproval, UsageMetrics} from '@vico/types';
import {type ApprovalMode, ToolCall, ToolResult} from '@vico/tool';
import type {Checkpoint} from '@vico/checkpoint';
import {ModelRequestContext} from '@vico/context';
import type {ReasoningEffort} from '@vico/model';
import type {ModelClient} from '@vico/model';
import type {ModelMessage, TextStreamPart, ToolSet} from 'ai';
import {Thread, Turn} from '@vico/thread';
import type {TurnSession} from '@vico/thread';

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

/** executeModelStep / callModel 共享上下文 */
export interface TurnContext<TToolSet extends ToolSet = ToolSet> {
  ctx: ModelRequestContext
  messages: ModelMessage[]
  session: TurnSession;
  decisions: Map<string, ToolCallApproval>;
  approvedTools: Map<string, ToolApproval>;
  /** turn 级中断信号，贯穿 model 调用和工具执行 */
  signal: AbortSignal;
  /** 流控制器，用于向客户端推送 chunk（引擎层协议 TextStreamPart） */
  controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  /** 本 turn 的 checkpoint 对象（startTurn/resumeTurn 创建，append-only 版本链：step 完成 / pause / 终态时由 loop-agent append 新版本） */
  checkpoint: Checkpoint;
  usage: UsageMetrics;
  /** 本次运行的思考强度（覆盖 agent 级 reasoning），不传则回退 this.reasoning */
  reasoning?: ReasoningEffort;
  /** 本次运行使用的模型客户端 */
  modelClient: ModelClient;
  /** 本次运行的审批政策模式，随 PolicyContext 透传给各 resolver */
  approvalMode?: ApprovalMode;
  /** turn 开始时注入的历史消息条数（context-overflow 压缩后据此重建内存历史前缀） */
  historyCount: number;
}


// turn staus
type TurnStatus = 'running' | 'completed' | 'aborted' | 'paused' | 'failed'

/** runStepLoop 返回的 loop 执行结果 */
export interface StepLoopResult {
  status: TurnStatus;
  steps: number;
  usage: UsageMetrics;
  error?: Error | string;
}

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: TurnStatus;
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

/** runTurn 选项 */
export interface RunOptions {
  /** 会话线程对象（必传，通过 agent.createThread() 创建） */
  thread: Thread;
  /** 思考强度（推理力度），可选；不传则回退到 agent 构造时的 reasoning */
  reasoning?: ReasoningEffort;
  /** 模型名，可选；仅切换模型，provider/apiKey/baseUrl 复用 agent 原始配置，不传则用 agent 默认模型 */
  model?: string;
  /** 审批政策模式，可选；不传则使用 agent 默认审批策略 */
  approvalMode?: ApprovalMode;
  /** 中断信号，可选；传入则复用之（由调用方控制中断），未传则内部自行构造 AbortController */
  signal?: AbortSignal;
}