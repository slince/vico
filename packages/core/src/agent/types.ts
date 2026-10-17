// @vico/core - LoopAgent module type definitions

import type {LanguageModelV4} from "@ai-sdk/provider";

/** 模型配置：provider + 模型名 + 连接凭据，createLanguageModel 据此构建 LanguageModelV4 */
export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** 模型上下文窗口 token 数；启用压缩（pressure 触发）时必填（provider v4 不暴露） */
  contextWindow?: number;
  /** 模型最大输出 token 数；作为模型请求默认输出上限，并预留为压缩预算的 completion 额度 */
  maxOutputTokens?: number;
}

/**
 * 模型引用：已解析的 LanguageModelV4 实例，或待解析的 ModelConfig
 */
export type ModelRef = LanguageModelV4 | ModelConfig

/** 判断 ModelRef 是否为已解析的 LanguageModelV4 实例（配置对象无 modelId 字段） */
export function isLanguageModelV4(ref: ModelRef): ref is LanguageModelV4 {
  return 'modelId' in ref;
}


/**
 * Token 用量统计 — 单次模型调用的完整用量明细（对齐 provider V4 usage，不含 raw）。
 *
 * inputTokens 覆盖提示词 token 及缓存读写明细；outputTokens 覆盖补全 token 与推理 token。
 * 各字段可能为 undefined（provider 未上报对应明细时）。
 */
export interface UsageMetrics {
  inputTokens: {
    /** 输入（prompt）token 总数 */
    total: number | undefined;
    /** 非缓存输入 token 数 */
    noCache: number | undefined;
    /** 读取的缓存输入 token 数 */
    cacheRead: number | undefined;
    /** 写入的缓存输入 token 数 */
    cacheWrite: number | undefined;
  };
  outputTokens: {
    /** 输出（completion）token 总数 */
    total: number | undefined;
    /** 文本输出 token 数 */
    text: number | undefined;
    /** 推理（reasoning）token 数 */
    reasoning: number | undefined;
  };
}

/** turn 执行过程中的流式事件（仅用于 agent.on() 订阅） */
export type TurnEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-delta'; content: string }
  | { type: 'tool-call-start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step-start'; step: number }
  | { type: 'step-end'; step: number }
  | { type: 'compacted'; summaryMessageId: string; archivedTurnIds: string[]; removedTokens: number; shadowedTokenCount: number }
  | { type: 'error'; error: string | Error }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-suggested'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'done'; usage: UsageMetrics };


export type ToolMetadata = Record<string, unknown>;