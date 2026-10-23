// @vico/core - 模型模块类型定义（消息/流类型全部使用 AI SDK 原生类型）
import type {ModelMessage} from 'ai';
import type {
  LanguageModelV4,
  LanguageModelV4File,
  LanguageModelV4FinishReason,
  LanguageModelV4ReasoningFile,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolResult,
  LanguageModelV4Usage,
  SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import type {Tool, ToolCall} from '@vico/tool';
import type {UsageMetrics} from '@vico/types';


/** provider 语言模型实例别名，隔离 @ai-sdk/provider 版本；vico 其它包应引用此别名而非直接依赖 provider */
export type LanguageModel = LanguageModelV4;

/** provider 流 part 别名，隔离 @ai-sdk/provider 版本；vico 其它包应引用此别名而非直接依赖 provider */
export type ModelStreamPart = LanguageModelV4StreamPart;

/** provider 工具调用 part 别名，语义同上 */
export type ModelToolCall = LanguageModelV4ToolCall;

/** provider 用量 part 别名，语义同上 */
export type ModelUsage = LanguageModelV4Usage;

/** provider 文件 part 别名，语义同上 */
export type ModelFile = LanguageModelV4File;

/** provider 推理文件 part 别名，语义同上 */
export type ModelReasoningFile = LanguageModelV4ReasoningFile;

/** provider 结束原因别名，语义同上 */
export type ModelFinishReason = LanguageModelV4FinishReason;

/** provider 工具结果 part 别名，语义同上 */
export type ModelToolResult = LanguageModelV4ToolResult;

/** provider 元数据别名，语义同上 */
export type ModelProviderMetadata = SharedV4ProviderMetadata;

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
  /** provider 原生 V4 流；无论由谁消费，text-delta / reasoning-delta / tool-call / finish / error 都会同步累积，供下方各读取方法复用 */
  stream: ReadableStream<ModelStreamPart>;
  /** 完整文本输出（text-delta 拼接）。stream 消费完毕（含外部消费）后 resolve；重复调用无副作用 */
  text(): Promise<string>;
  /** 完整推理内容（reasoning-delta 拼接）。语义同 text()：stream 消费完毕（含外部消费）后 resolve */
  reasoning(): Promise<string>;
  /** 模型生成的工具调用列表（tool-call part 的 args 已 JSON 解析，不含 provider 端已执行调用）。语义同 text() */
  toolCalls(): Promise<ToolCall[]>;
  /** 完整模型调用结果（文本/推理/工具调用/用量/错误）。语义同 text() */
  result(): Promise<CallModelResult>;
}

/** 模型调用的完整结果：文本 / 推理 / 工具调用 / 用量 / 错误 */
export interface CallModelResult {
  /** 模型生成的完整文本 */
  text: string;
  /** 模型推理/思考内容（reasoning tokens，如 o1/DeepSeek-R1 的内部推理链） */
  reasoning: string;
  /** 模型请求的工具调用（本地执行队列，不含 provider 端已执行的调用） */
  toolCalls: ToolCall[];
  /** 本次调用的 token 用量 */
  usage: UsageMetrics;
  /** 错误信息（如有） */
  error?: string | Error;
}

/** 模型配置：provider + 模型名 + 连接凭据，createLanguageModel 据此构建 LanguageModel */
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
 * 模型引用：已解析的 LanguageModel 实例，或待解析的 ModelConfig
 */
export type ModelRef = LanguageModel | ModelConfig;

/** 判断 ModelRef 是否为已解析的 LanguageModel 实例（配置对象无 modelId 字段） */
export function isLanguageModel(ref: ModelRef): ref is LanguageModel {
  return 'modelId' in ref;
}
