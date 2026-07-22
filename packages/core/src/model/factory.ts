// @vico/core - LanguageModel 工厂：根据 ModelRef 创建 AI SDK LanguageModel
import {createOpenAI} from '@ai-sdk/openai';
import {createAnthropic} from '@ai-sdk/anthropic';
import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ModelRef} from '../agent-loop/types.js';

/**
 * 从 ModelRef 创建 LanguageModel 实例。
 *
 * openai 提供商标配 OpenAI、DeepSeek、Qwen、custom 等兼容接口；
 * anthropic 使用原生 SDK。
 *
 * @param ref - 模型引用，包含 provider、model、apiKey、baseUrl 等配置
 * @returns AI SDK 的 LanguageModelV4 实例
 */
export function createLanguageModel(ref: ModelRef): LanguageModelV4 {
  const apiKey = ref.apiKey ?? undefined;
  const baseURL = ref.baseUrl ?? undefined;
  const provider = ref.provider.toLowerCase();

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(ref.model);
    case 'deepseek':
    case 'qwen':
    case 'custom':
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(ref.model);
  }
}
