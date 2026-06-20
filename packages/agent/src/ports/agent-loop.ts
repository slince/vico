import type { AgentContext, Message } from './agent.js';
import type { TurnResult } from './agent-runtime.js';

/**
 * AgentLoop — Agent 核心循环引擎端口。
 * 执行 "思考 → 行动 → 观察" 的多步循环。
 */
export interface AgentLoop {
  /** 执行一个完整的 Turn */
  runTurn(context: AgentContext, signal: AbortSignal): Promise<TurnResult>;

  /** 中断当前 Turn */
  interrupt(): void;

  /** 引导：注入修正文本 */
  steer(text: string): void;

  /** 获取当前 Turn 累积的消息 */
  getMessages(): Message[];
}
