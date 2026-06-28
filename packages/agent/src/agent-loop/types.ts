// @vico/agent - AgentLoop module type definitions
import type {ModelMessage} from '../model/types.js';
import type {Thread, Turn} from '../thread/types.js';

/** 模型引用 */
export interface ModelRef {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number; 
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** 一次 turn 的会话标识，贯穿 model 调用和工具执行 */
export interface TurnSession {
  workspace: string;
  thread: Thread;
  turn: Turn;
}

/** runTurn 选项 */
export interface RunTurnOptions {
  scopeId?: string;
  userId?: string;
  workspace?: string;
}

// ── 核心领域模型：Thread > Turn > Step ──

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface Step {
  /** 当前步骤编号（0 起始） */
  index: number;
  /** 所属 thread */
  threadId: string;
  /** 执行作用域 */
  scopeId: string;
  /** 中断信号 */
  signal: AbortSignal;
}

/** turn 执行过程中的流式事件（仅用于 agent.on() 订阅） */
export type TurnEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step-start'; step: number }
  | { type: 'step-end'; step: number }
  | { type: 'compacted'; removedTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { input: number; output: number } };
