// @vico/agent - ModelClient：对 LanguageModelV4.doStream() 的薄封装层
import { standardizePrompt, convertToLanguageModelPrompt, prepareTools } from 'ai/internal';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { toToolSet } from './message-utils.js';
import type { ModelRequest, ModelStreamResult } from './types.js';

/**
 * Provider 层语言模型的薄封装。
 *
 * 用 ai/internal 积木将原生 ModelMessage / Vico Tool 转换为 provider 格式，
 * 调用 doStream()，透出原生 LanguageModelV4StreamPart 流。
 */
export class ModelClient {
  constructor(private model: LanguageModelV4) {}

  /**
   * 流式调用模型。
   *
   * @param request - 模型请求参数（原生消息、Vico 工具、采样与推理配置）
   * @param abortSignal - 中断信号
   * @returns provider 原生 V4 流
   */
  async stream(request: ModelRequest, abortSignal?: AbortSignal): Promise<ModelStreamResult> {
    // 校验并标准化消息（system 合并进 instructions）
    const standardized = await standardizePrompt({ system: request.system, messages: request.messages });

    // 原生 ModelMessage → LanguageModelV4Prompt（download 不启用，纯文本/工具场景无下载路径）
    const prompt = await convertToLanguageModelPrompt({
      prompt: standardized,
      supportedUrls: await this.model.supportedUrls,
      download: undefined,
    });

    // Vico Tool → ai ToolSet → provider 工具格式
    const tools = request.tools?.length ? await prepareTools({ tools: toToolSet(request.tools) }) : undefined;

    const result = await this.model.doStream({
      prompt,
      tools,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      // 不传 reasoning 字段时交给 provider 默认行为
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      abortSignal,
    });

    return { stream: result.stream };
  }
}
