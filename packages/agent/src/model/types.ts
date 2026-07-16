// @vico/agent - 模型模块类型定义（消息/流类型全部使用 AI SDK 原生类型）
import type { ModelMessage } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { Tool } from '../tool/types.js';

/** 推理力度（透传 LanguageModelV4CallOptions.reasoning） */
export type ReasoningEffort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** ModelClient.stream() 调用参数 */
export interface ModelRequest {
  /** 系统提示词（standardizePrompt 会合并进 instructions） */
  system?: string;
  /** 原生 AI SDK ModelMessage 消息列表 */
  messages: ModelMessage[];
  /** Vico 工具列表，内部经 toToolSet + prepareTools 转换为 provider 工具格式 */
  tools?: Tool[];
  maxOutputTokens?: number;
  temperature?: number;
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() 返回值 — provider 原生 V4 流 */
export interface ModelStreamResult {
  stream: ReadableStream<LanguageModelV4StreamPart>;
}
