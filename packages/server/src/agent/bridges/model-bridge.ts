import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { ModelConfigRow } from '../../services/model/types.js';

/**
 * 根据 Vico model_configs 行创建 AI SDK LanguageModel。
 *
 * 支持的 provider:
 * - openai, deepseek, qwen, custom → 通过 createOpenAI() 创建（OpenAI 兼容协议）
 * - anthropic → 通过 createAnthropic() 创建
 *
 * @param modelConfig - 来自 model_configs 表的模型配置行
 * @returns AI SDK LanguageModel 实例，可直接传入 Mastra Agent
 */
export function resolveModelProvider(modelConfig: ModelConfigRow): MastraModelConfig {
  const apiKey = modelConfig.api_key;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
  }
}
