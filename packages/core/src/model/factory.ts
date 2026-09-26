// @vico/core - LanguageModel 工厂：根据 ModelConfig 创建 AI SDK LanguageModel
import {createOpenAI} from '@ai-sdk/openai';
import {createAnthropic} from '@ai-sdk/anthropic';
import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ModelConfig} from '../agent/types.js';

/**
 * 从 ModelConfig 创建 LanguageModel 实例。
 *
 * openai 提供商标配 OpenAI、DeepSeek、Qwen、custom 等兼容接口；
 * anthropic 使用原生 SDK。
 *
 * @param config - 模型配置，包含 provider、model、apiKey、baseUrl 等
 * @returns AI SDK 的 LanguageModelV4 实例
 */
export function createLanguageModel(config: ModelConfig): LanguageModelV4 {
  const apiKey = config.apiKey ?? undefined;
  const baseURL = config.baseUrl ?? undefined;
  const provider = config.provider.toLowerCase();

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(config.model);
    case 'deepseek':
    case 'qwen':
    case 'custom':
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(config.model);
  }
}
