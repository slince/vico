// @vico/rag — Embedder barrel export + factory

import { FastEmbedEmbedder } from './fastembed.js';
import { OpenAIEmbedder } from './openai.js';
import type { BatchEmbedder } from '../types/embedder.js';

/**
 * 嵌入器工厂 — 从配置字符串创建 BatchEmbedder 实例。
 *
 * 支持的字符串：
 * - "fastembed" — 本地 ONNX 嵌入（需要 @vico/fastembed 或类似包）
 * - "openai:<url>" — OpenAI-compatible API
 *
 * @param config - 嵌入器配置字符串或对象
 * @returns BatchEmbedder 实例，或 undefined（无法解析时）
 */
export function createEmbedder(config: string | { provider: string; model?: string; apiKey?: string }): BatchEmbedder | undefined {
  const provider = typeof config === 'string' ? config : config.provider;

  if (provider === 'fastembed') {
    return new FastEmbedEmbedder();
  }

  if (provider === 'openai' || provider.startsWith('openai:')) {
    const baseUrl = typeof config === 'object' ? config.model : provider.split(':')[1];
    return new OpenAIEmbedder({
      baseUrl,
      apiKey: typeof config === 'object' ? config.apiKey : undefined,
    });
  }

  return undefined;
}

export { FastEmbedEmbedder, type FastEmbedOptions } from './fastembed.js';
export { OpenAIEmbedder, type OpenAIEmbedderOptions } from './openai.js';
