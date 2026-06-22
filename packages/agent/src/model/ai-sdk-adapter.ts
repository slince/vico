// @vico/agent - AISDKModelClient: AI SDK v6 适配器，实现 ModelClient 端口
import type {LanguageModel} from 'ai';
import {streamText} from 'ai';
import type {ModelClient, ModelRequest, ModelStreamChunk,} from './types.js';
import type {Tool} from '../tool/types.js';

/**
 * 将框架 Tool 数组转为 AI SDK v6 streamText 可接受的 tools 对象。
 *
 * AI SDK v6 的 Tool 类型要求 inputSchema 为 FlexibleSchema（Zod schema、
 * Validator 或 JSONSchema7）。此处 Tool.inputSchema 为无类型的 JSON
 * 对象，通过类型断言传入——不参与工具执行侧的校验，仅用于 LLM tool definition。
 */
function toAISDKTools(tools: Tool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }
  return result;
}

/**
 * AISDKModelClient — 基于 AI SDK v6 streamText 的模型客户端适配器。
 *
 * 将 ModelClient 端口的请求转换为 AI SDK 调用，直接透传 AI SDK 的
 * {@link TextStreamPart} 流。ModelStreamChunk 即为 TextStreamPart
 * 的别名，不做二次映射。
 */
export class AISDKModelClient implements ModelClient {
  /**
   * @param languageModel - AI SDK LanguageModel 实例（由 Provider 工厂创建，如 createOpenAI().chat()）
   * @param provider - 提供商标识（如 "openai"、"anthropic"）
   * @param model - 模型名称（如 "gpt-4o"、"claude-sonnet-4-20250514"）
   */
  constructor(
    private languageModel: LanguageModel,
    public readonly provider: string,
    public readonly model: string,
  ) {}

  /** 流式调用 LLM，直接透传 AI SDK fullStream chunk */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const result = streamText({
      model: this.languageModel,
      system: request.system,
      messages: request.messages as any, // AI SDK v6 接受兼容格式
      tools: toAISDKTools(request.tools) as any,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
      abortSignal: request.abortSignal,
    });

    for await (const chunk of result.fullStream) {
      yield chunk as unknown as ModelStreamChunk;
    }
  }
}
