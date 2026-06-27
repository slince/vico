// @vico/agent - ModelClient：对 LanguageModelV3.doStream() 的薄封装层
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { convertToPrompt } from './prompt-converter.js';
import { convertTools } from './tool-converter.js';
import { processStreamParts } from './stream-processor.js';
import type { ModelRequest, ModelStreamResult } from './types.js';

/**
 * Provider 层语言模型的薄封装。
 * 将 Vico 类型转换为 provider 类型，调用 doStream()，并处理原始流。
 */
export class ModelClient {
  constructor(private model: LanguageModelV3) {}

  /**
   * 流式调用模型。将内部类型转换为 provider 格式，调用模型，
   * 返回类型化的异步生成器。
   */
  async stream(request: ModelRequest): Promise<ModelStreamResult> {
    const prompt = convertToPrompt(request.messages, request.system);
    const tools = request.tools?.length ? convertTools(request.tools) : undefined;

    const result = await this.model.doStream({
      prompt,
      tools,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      abortSignal: request.abortSignal,
    });

    return {
      stream: processStreamParts(result.stream),
    };
  }
}
