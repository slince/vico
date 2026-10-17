// @vico/core - Tool module type definitions
import type {z} from 'zod';
import type {ToolCallApproval, TurnSession} from "../agent/loop-agent-options.js";

/** 工具审批策略 */
export type ToolPolicy = 'auto' | 'always' | 'never';

/** 工具类别：只读 or 变更 */
export type ToolKind = 'readonly' | 'mutation';

/** 工具标签：绑定工作目录 */
export type ToolTag = 'requires-workspace';

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
  /** 工具标签（如绑定工作目录 "requires-workspace"） */
  tags: ToolTag[];
  /** 执行工具调用 */
  execute(call: ToolCall<TInput>, ctx: ToolCallContext): Promise<TOutput>;
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
export interface ToolCallContext {
  session: TurnSession;
  signal: AbortSignal;
  /** 本 call 的审批决策（resume 恢复时才有）；澄清类工具可从中读取用户回答 */
  approval?: ToolCallApproval;
}

/** 审批状态：approved 直接执行，denied 拒绝，paused 等待用户审批后恢复 */
export type ApprovalStatus = 'approved' | 'denied' | 'paused';

export interface ApprovalDecision {
  status: ApprovalStatus;
  reason?: string;
  /** suggest 策略时标记为 true，引擎不阻塞，供 UI 展示提示 */
  suggested?: boolean;
}

/**
 * 审批政策模式 — 用户在 composer 选择、随请求下发的全局审批策略。
 *
 * - `approve-all`：审查模式，任何工具调用都需要用户审批
 * - `readonly`：只读模式，只读工具自动通过，修改/更新/删除需审批
 * - `workspace`：工作区内修改，workspace 内完全权限，越界需审批
 * - `full-access`：完全权限，不做任何审批直接通过
 */
export type ApprovalMode = 'approve-all' | 'readonly' | 'workspace' | 'full-access';

/** 审批策略上下文 */
export interface PolicyContext<TInput = unknown> {
  /** 工具调用参数，供自定义 resolver 做细粒度决策 */
  toolArgs?: TInput;
  /** 当前 session 的工作目录 */
  workspace?: string;
  /** 本次运行的审批政策模式，未显式指定时为 undefined（走 agent 默认策略） */
  approvalMode?: ApprovalMode;
}

/**
 * 审批 resolver — 用 support 声明参与范围，用 order 声明优先级，用 resolve 给出决策。
 *
 * 组合时按 order 升序（数值越小越优先）调度，首个 support 返回 true 的
 * resolver 的 resolve 即为终态。内置集见 {@link defaultApprovalResolvers}，
 * 创建 Agent 时可注入自定义实现。
 */
export interface ApprovalResolver<TInput = unknown, TOutput = unknown> {
  /** 优先级，数值越小越优先；composeResolvers 按此升序调度，可引用 ApprovalPriority 档位 */
  order(): number;
  /** 是否参与该工具的审批判断；返回 false 则跳过该 resolver（context 含 approvalMode 等运行时信息） */
  support(tool: Tool<TInput, TOutput>, context: PolicyContext<TInput>): boolean;
  /** 决策逻辑，仅当 support 返回 true 时被调用 */
  resolve(
    call: ToolCall<TInput>,
    tool: Tool<TInput, TOutput>,
    policy: ToolPolicy,
    context: PolicyContext<TInput>,
  ): ApprovalDecision | Promise<ApprovalDecision>;
}

/** 组合后的判定函数，供引擎直接调用 */
export type ApprovalDecider<TInput = unknown, TOutput = unknown> = (
  call: ToolCall<TInput>,
  tool: Tool<TInput, TOutput>,
  policy: ToolPolicy,
  context: PolicyContext<TInput>,
) => ApprovalDecision | Promise<ApprovalDecision>;

