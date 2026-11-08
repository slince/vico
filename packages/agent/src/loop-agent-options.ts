import type {UsageMetrics} from '@vico/types';
import {type ApprovalMode, type Tool, ToolApproval, ToolCall, ToolCallApproval, ToolResult} from '@vico/tool';
import type {Checkpoint} from '@vico/checkpoint';
import type {ModelClient, ModelMessage, ReasoningEffort} from '@vico/model';
import type {ChunkType} from '@vico/stream';
import type {StreamWriter} from '@vico/utils';
import {Thread, Turn} from '@vico/thread';
import type {AgentMessage, TurnSession} from '@vico/thread';

/** executeModelStep 返回值 */
export interface ModelStepResult {
  /** 步骤执行后的动作：break=终止循环, pause=暂停等待审批, continue=继续下一步 */
  action: 'break' | 'pause' | 'continue';
  /** 审批处置结果（通过 / 拒绝 / 待审批三组），action 为 pause/continue 时提供；break 时无 */
  resolved?: ResolvedApprovals;
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
export interface TurnContext {
  /** 洋葱处理器产出的最终系统提示词（渲染快照，turn 内不变） */
  systemPrompt: string
  /** 洋葱处理器产出的最终工具列表（快照，turn 内不变） */
  tools: Tool[]
  /** 内存消息链（含所属 turnId 自描述） */
  messages: AgentMessage[]
  session: TurnSession;
  decisions: Map<string, ToolCallApproval>;
  approvedTools: Map<string, ToolApproval>;
  /** turn 级中断信号，贯穿 model 调用和工具执行 */
  signal: AbortSignal;
  /** 引擎输出写入器，用于向客户端推送 chunk（write 追加单条 / forward 灌入整条流） */
  output: StreamWriter<ChunkType>;
  /** 本次 run 的 runId（盖章到每条 chunk） */
  runId: string;
  /** 本 turn 的 checkpoint 对象（startTurn/resumeTurn 创建，append-only 版本链：step 完成 / pause / 终态时由 loop-agent append 新版本） */
  checkpoint: Checkpoint;
  /** 当前 step 序号（0 起始），随循环推进；saveCheckpoint 据此落版本 */
  stepIndex: number;
  usage: UsageMetrics;
  /** 本次运行的思考强度（覆盖 agent 级 reasoning），不传则回退 this.reasoning */
  reasoning?: ReasoningEffort;
  /** 本次运行使用的模型客户端 */
  modelClient: ModelClient;
  /** 本次运行的审批政策模式，随 PolicyContext 透传给各 resolver */
  approvalMode?: ApprovalMode;
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
  /** 本次 run 标识，可选；由调用方（如 ag-ui 路由层）传入以关联前端请求，缺省时内部生成 UUID */
  runId?: string;
  /** 思考强度（推理力度），可选；不传则回退到 agent 构造时的 reasoning */
  reasoning?: ReasoningEffort;
  /** 模型名，可选；仅切换模型，provider/apiKey/baseUrl 复用 agent 原始配置，不传则用 agent 默认模型 */
  model?: string;
  /** 审批政策模式，可选；不传则使用 agent 默认审批策略 */
  approvalMode?: ApprovalMode;
  /** 中断信号，可选；传入则复用之（由调用方控制中断），未传则内部自行构造 AbortController */
  signal?: AbortSignal;
}