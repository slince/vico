// @vico/agent - Default ModelClientFactory implementation
import {createOpenAI} from '@ai-sdk/openai';
import {createAnthropic} from '@ai-sdk/anthropic';
import {AISDKModelClient} from './ai-sdk-adapter.js';
import type {ModelClient, ModelClientFactory} from './types.js';
import type {ModelRef} from '../agent-loop/types.js';
import {LanguageModel} from "ai";

/**
 * 从 ModelRef 创建 LanguageModel 实例。
 * openai 提供商标配 OpenAI、DeepSeek、Qwen、custom 等兼容接口；
 * anthropic 使用原生 SDK。
 */
function createLanguageModel(ref: ModelRef): LanguageModel {
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

/**
 * 默认 ModelClient 工厂。
 * 根据 ModelRef.provider 自动选择 AI SDK provider 并创建 AISDKModelClient。
 */
export const defaultModelFactory: ModelClientFactory = (ref: ModelRef): ModelClient => {
  const languageModel = createLanguageModel(ref);
  return new AISDKModelClient(languageModel, ref.provider, ref.model);
};
