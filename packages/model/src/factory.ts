// @vico/core - LanguageModel 工厂：根据 ModelConfig 创建 AI SDK LanguageModel
import {createOpenAI} from '@ai-sdk/openai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {createAnthropic} from '@ai-sdk/anthropic';
import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ModelConfig} from './types.js';

/**
 * OpenAI 兼容第三方 provider 的默认 baseURL 兜底。
 *
 * createOpenAICompatible 要求显式 baseURL；config.baseUrl 缺失时按 provider 补默认。
 * custom 无内置端点，回退 OpenAI 官方地址（与旧 createOpenAI 未传 baseURL 时的行为一致）。
 */
const COMPATIBLE_DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  custom: 'https://api.openai.com/v1',
};

/**
 * 从 ModelConfig 创建 LanguageModel 实例。
 *
 * openai 使用原生 SDK；deepseek/qwen/custom 走 OpenAI 兼容层 ——
 * createOpenAICompatible 原生支持 DeepSeek 的 reasoning_content 双向透传
 * （接收 reasoning_content → reasoning-delta；回传 reasoning part → reasoning_content），
 * 而 @ai-sdk/openai 的 Chat Completions 路径对 reasoning_content 完全无视。
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
      return createOpenAICompatible({
        name: provider,
        apiKey,
        baseURL: baseURL ?? COMPATIBLE_DEFAULT_BASE_URLS[provider] ?? 'https://api.openai.com/v1',
      }).chatModel(config.model);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(config.model);
  }
}
