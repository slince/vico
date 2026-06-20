// @vico/agent - AgentLoop module type definitions
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { ContextProcessor } from '../prompt/context-processor.js';
import type { ToolHost, ToolExecutionContext } from '../tool/types.js';
import type { ToolCall, ToolResult, ToolSpec } from '../contracts/tool.js';
import type { EventRecorder } from '../observable/types.js';
import type { SpanTracker } from '../observable/types.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import type { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';
import type { AgentConfig } from '../contracts/agent.js';

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  config: AgentConfig;
  model: ModelClient;
  toolHost: ToolHost;
  /** 上下文处理器列表 — 在 model 调用前按优先级依次执行。缺少时回退到无增强的裸模式 */
  processors?: ContextProcessor[];
  /** 绑定的工具列表（注入 LLM 请求） */
  boundTools?: ToolSpec[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  approvalGate?: ApprovalGate;
  hooks?: CompositeHookRunner;
  events: EventRecorder;
  spanTracker: SpanTracker;
}
