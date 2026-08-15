// @vico/core - LoopAgent module type definitions

/** 模型引用 */
export interface ModelRef {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

/** Token 用量统计 */
export interface UsageMetrics {
  input: number;
  output: number;
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
  | { type: 'error'; error: string | Error }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-suggested'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'done'; usage: UsageMetrics };


export type ToolMetadata = Record<string, unknown>;