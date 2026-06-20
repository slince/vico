// @vico/agent - AgentLoop module type definitions
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { PromptAssembler, PromptContext } from '../prompt/types.js';
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
export interface AgentLoop {
  /** 执行一个 turn：将 userMessage 追加到 history，运行 agentic loop 后返回结果 */
  runTurn(
    threadId: string,
    history: ModelMessage[],
    userMessage: ModelMessage,
    signal: AbortSignal,
  ): Promise<TurnResult>;

  /** 中断当前正在执行的 turn */
  interrupt(): void;

  /** 注入引导文本（human-in-the-loop） */
  steer(text: string): void;
}

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
