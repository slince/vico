// @vico/core - UI 流类型（直接复用 AI SDK 原生类型）
import type { ModelMessage, UIMessage } from 'ai';
import type { UsageMetrics } from '@vico/types';
import type { ToolCall } from '@vico/tool';

/**
 * Agent.stream/invoke 接受的消息类型：
 * - `string` — 纯文本，转为单条 user 消息
 * - `UIMessage[]` — useChat 原生消息（含历史），校验转换后取最后一条作为本轮输入
 * - `ModelMessage[]` — 原生模型消息组，原样作为本轮输入（调用方全权控制，如 few-shot、预置上下文）
 */
export type UserMessage = string | UIMessage[] | ModelMessage[];

/** turn 执行过程中的流式事件（仅用于 agent.on() 订阅） */
export type TurnEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step-start'; step: number }
  | { type: 'step-end'; step: number }
  | { type: 'compacted'; summaryMessageId: string; archivedTurnIds: string[]; removedTokens: number }
  | { type: 'error'; error: string | Error }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-suggested'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'done'; usage: UsageMetrics };

/** callModel 的返回值 */
export interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型推理/思考内容（reasoning tokens，如 o1/DeepSeek-R1 的内部推理链） */
  reasoning: string;
  /** 模型请求的工具调用 */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: UsageMetrics;
  /** 错误信息（如有） */
  error?: string | Error;
}
