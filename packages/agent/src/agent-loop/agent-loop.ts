// @vico/agent - AgentLoop port interface and TurnResult type
// Minimal definitions for Task 9; full implementation deferred to Task 10.
import type { ModelMessage } from '../model/model-client.js';

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
