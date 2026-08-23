// @vico/rag — Embedder barrel export + factory

import { FastEmbedEmbedder } from './fastembed.js';
import { OpenAIEmbedder } from './openai.js';
import type { BatchEmbedder } from '../types/embedder.js';

/**
 * 嵌入器工厂 — 从配置创建 BatchEmbedder 实例。
 *
 * 支持字符串：
 * - "fastembed" — 本地 ONNX 嵌入
 * - "openai:<baseUrl>" — OpenAI-compatible API（自定义 endpoint）
 *
 * 支持对象：
 * - { provider: "openai", model?, baseUrl?, apiKey? }
 *
 * @param config - 嵌入器配置字符串或对象
 * @returns BatchEmbedder 实例，或 undefined（无法解析时）
 */
export function createEmbedder(config: string | { provider: string; model?: string; baseUrl?: string; apiKey?: string }): BatchEmbedder | undefined {
  const provider = typeof config === 'string' ? config : config.provider;

  if (provider === 'fastembed') {
    return new FastEmbedEmbedder();
  }

  if (provider === 'openai' || provider.startsWith('openai:')) {
    const isString = typeof config === 'string';
    return new OpenAIEmbedder({
      // string 形式 "openai:<baseUrl>" 冒号后是 endpoint；object 形式 model/baseUrl/apiKey 独立映射
      model: isString ? undefined : config.model,
      baseUrl: isString ? provider.slice(provider.indexOf(':') + 1) : config.baseUrl,
      apiKey: isString ? undefined : config.apiKey,
    });
  }

  return undefined;
}

export { FastEmbedEmbedder, type FastEmbedOptions } from './fastembed.js';
export { OpenAIEmbedder, type OpenAIEmbedderOptions } from './openai.js';
