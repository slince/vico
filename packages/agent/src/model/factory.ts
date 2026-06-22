// @vico/agent - LanguageModel 工厂：根据 ModelRef 创建 AI SDK LanguageModel
import {createOpenAI} from '@ai-sdk/openai';
import {createAnthropic} from '@ai-sdk/anthropic';
import type {LanguageModel} from 'ai';
import type {ModelRef} from '../agent-loop/types.js';

/**
 * 从 ModelRef 创建 LanguageModel 实例。
 * openai 提供商标配 OpenAI、DeepSeek、Qwen、custom 等兼容接口；
 * anthropic 使用原生 SDK。
 */
export function createLanguageModel(ref: ModelRef): LanguageModel {
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
