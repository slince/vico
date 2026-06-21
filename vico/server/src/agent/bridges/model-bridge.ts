import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { ModelConfigRow } from '../../services/model/types.js';

/**
 * 根据 Vico model_configs 行创建 AI SDK LanguageModel。
 */
export function resolveModelProvider(modelConfig: ModelConfigRow): LanguageModel {
  const apiKey = modelConfig.api_key;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name) as unknown as LanguageModel;
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name) as unknown as LanguageModel;
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name) as unknown as LanguageModel;
  }
}
