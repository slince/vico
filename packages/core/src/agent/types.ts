// @vico/core - LoopAgent module type definitions

import type {LanguageModelV4} from "@ai-sdk/provider";

/** 模型配置：provider + 模型名 + 连接凭据，createLanguageModel 据此构建 LanguageModelV4 */
export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

/**
 * 模型引用：已解析的 LanguageModelV4 实例，或待解析的 ModelConfig
 */
export type ModelRef = LanguageModelV4 | ModelConfig

/** 判断 ModelRef 是否为已解析的 LanguageModelV4 实例（配置对象无 modelId 字段） */
export function isLanguageModelV4(ref: ModelRef): ref is LanguageModelV4 {
  return 'modelId' in ref;
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