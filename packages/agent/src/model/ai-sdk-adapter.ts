// @vico/agent - AISDKModelClient: AI SDK v6 适配器，实现 ModelClient 端口
import type {LanguageModel} from 'ai';
import {streamText} from 'ai';
import type {ModelClient, ModelRequest, ModelStreamChunk,} from './types.js';
import type {ToolSpec} from '../contracts/tool.js';

/**
 * 将框架 ToolSpec 数组转为 AI SDK v6 streamText 可接受的 tools 对象。
 *
 * AI SDK v6 的 Tool 类型要求 inputSchema 为 FlexibleSchema（Zod schema、
 * Validator 或 JSONSchema7）。此处 ToolSpec.inputSchema 为无类型的 JSON
 * 对象，通过类型断言传入——不参与工具执行侧的校验，仅用于 LLM tool definition。
 */
function toAISDKTools(tools: ToolSpec[]): Record<string, unknown> {
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
 * 将 ModelClient 端口的标准化请求转换为 AI SDK 调用，并把 AI SDK 的
 * TextStreamPart 流映射为平台无关的 {@link ModelStreamChunk} 联合类型。
 * 通过这一层适配，上层管道无需关心 AI SDK 的版本差异。
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

  /** 流式调用 LLM，返回标准化 chunk 异步迭代器 */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    try {
      const result = streamText({
        model: this.languageModel,
        system: request.system,
        messages: request.messages as any, // AI SDK v6 接受兼容格式
        tools: toAISDKTools(request.tools) as any,
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        abortSignal: request.abortSignal,
      });

      let usageEmitted = false;

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            // TextStreamPart: { type: 'text-delta', text: string, ... }
            yield { type: 'text_delta', content: (chunk as any).text ?? '' };
            break;

          case 'reasoning-delta':
            // TextStreamPart: { type: 'reasoning-delta', text: string, ... }
            yield { type: 'reasoning_delta', content: (chunk as any).text ?? '' };
            break;

          case 'tool-call': {
            // TextStreamPart: { type: 'tool-call' } & TypedToolCall<TOOLS>
            const tc = chunk as any;
            yield {
              type: 'tool_call_complete',
              id: tc.toolCallId ?? '',
              name: tc.toolName ?? '',
              args: tc.input ?? {},
            };
            break;
          }

          case 'finish': {
            // TextStreamPart: { type: 'finish', finishReason, totalUsage }
            const f = chunk as any;
            if (!usageEmitted && f.totalUsage) {
              yield {
                type: 'usage',
                input: f.totalUsage.inputTokens ?? 0,
                output: f.totalUsage.outputTokens ?? 0,
              };
              usageEmitted = true;
            }
            yield {
              type: 'completed',
              finishReason: f.finishReason ?? 'stop',
            };
            break;
          }

          case 'error':
            // TextStreamPart: { type: 'error', error: unknown }
            yield {
              type: 'error',
              message: String((chunk as any).error ?? 'unknown error'),
            };
            break;

          // 忽略其他 chunk 类型（start-step、tool-result、file 等），
          // 只映射 ModelStreamChunk 联合类型中已定义的类别
          default:
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
    }
  }
}
