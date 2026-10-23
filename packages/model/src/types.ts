// @vico/core - 模型模块类型定义（消息/流类型全部使用 AI SDK 原生类型）
import type {ModelMessage} from 'ai';
import type {LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4ToolCall} from '@ai-sdk/provider';
import type {Tool, ToolCall} from '@vico/tool';


/** provider 流 part 别名，隔离 @ai-sdk/provider 版本；vico 其它包应引用此别名而非直接依赖 provider */
export type ModelStreamPart = LanguageModelV4StreamPart;

/** provider 工具调用 part 别名，语义同上 */
export type ModelToolCall = LanguageModelV4ToolCall;

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
  /** 中断信号，透传 doStream 用于取消流式调用 */
  abortSignal?: AbortSignal;
}

/** ModelClient.stream() 返回值 — 可读流与完整文本/推理内容/工具调用 promise 的结合体 */
export interface ModelStreamResult {
  /** provider 原生 V4 流；无论由谁消费，text-delta / reasoning-delta / tool-call 都会同步累积，供 text()/reasoning()/toolCalls() 复用 */
  stream: ReadableStream<ModelStreamPart>;
  /** 完整文本输出（text-delta 拼接）。stream 消费完毕（含外部消费）后 resolve；重复调用无副作用 */
  text(): Promise<string>;
  /** 完整推理内容（reasoning-delta 拼接）。语义同 text()：stream 消费完毕（含外部消费）后 resolve */
  reasoning(): Promise<string>;
  /** 模型生成的工具调用列表（tool-call part 的 args 已 JSON 解析）。stream 消费完毕（含外部消费）后完整 */
  toolCalls(): Promise<ToolCall[]>;
}

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
export type ModelRef = LanguageModelV4 | ModelConfig;

/** 判断 ModelRef 是否为已解析的 LanguageModelV4 实例（配置对象无 modelId 字段） */
export function isLanguageModelV4(ref: ModelRef): ref is LanguageModelV4 {
  return 'modelId' in ref;
}
