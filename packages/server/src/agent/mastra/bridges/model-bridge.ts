// Bridge 1: Vico ModelConfigRow → AI SDK LanguageModel
// 根据 Vico model_configs 表中的 provider 字段路由到对应 AI SDK provider

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDefaultModel, getModelById, type ModelConfigRow } from '../../model-registry.js';

/**
 * 根据 Vico model_configs 行创建对应的 AI SDK LanguageModel 实例。
 * 根据 provider 字段路由到 OpenAI / Anthropic / OpenAI 兼容接口。
 * 不在此处包裹 withMastra()，因为 withMastra 需要在 Agent 构建时根据
 * 每请求的 threadId/resourceId 动态配置 memory 和 processors。
 */
export function resolveModelProvider(modelConfig: ModelConfigRow) {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL })(modelConfig.model_name);
  }
}

/**
 * 根据 Vico Agent 配置解析其使用的模型。
 * 若 agent 指定了 model_id，使用该模型；否则使用租户默认模型。
 */
export function resolveAgentModel(tenantId: string, modelId?: string) {
  let modelConfig: ModelConfigRow | null;

  if (modelId) {
    modelConfig = getModelById(tenantId, modelId);
  } else {
    modelConfig = getDefaultModel(tenantId);
  }

  if (!modelConfig) {
    throw new Error('No LLM model configured. Please add a model in Settings first.');
  }

  return {
    model: resolveModelProvider(modelConfig),
    modelConfig,
  };
}
