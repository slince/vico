// @vico/agent - AgentLoop module type definitions
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { PromptAssembler } from '../prompt/assembler.js';
import type { PromptContext } from '../prompt/types.js';
import type { ToolHost, ToolExecutionContext } from '../tool/types.js';
import type { ToolCall, ToolResult } from '../contracts/tool.js';
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

/** Agent 循环端口 — 驱动单个对话 turn 的执行 */
/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  config: AgentConfig;
  model: ModelClient;
  toolHost: ToolHost;
  promptAssembler: PromptAssembler;
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  approvalGate?: ApprovalGate;
  hooks?: CompositeHookRunner;
  events: EventRecorder;
  spanTracker: SpanTracker;
}
