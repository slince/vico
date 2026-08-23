// @vico/rag — Embedder barrel export + factory

import { FastEmbedEmbedder } from './fastembed.js';
import { OpenAIEmbedder } from './openai.js';
import type { BatchEmbedder } from '../types/embedder.js';

/** createEmbedder 的 object 配置 */
interface EmbedderObjectConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  /** fastembed 专用：模型缓存目录（默认 ~/.cache/huggingface） */
  cacheDir?: string;
  /** fastembed 专用：是否允许联网下载模型 */
  allowRemoteModels?: boolean;
}

/**
 * 嵌入器工厂 — 从配置创建 BatchEmbedder 实例。
 *
 * 支持字符串：
 * - "fastembed" — 本地 ONNX 嵌入
 * - "openai:<baseUrl>" — OpenAI-compatible API（自定义 endpoint）
 *
 * 支持对象：
 * - { provider: "openai", model?, baseUrl?, apiKey? }
 * - { provider: "fastembed", model?, cacheDir?, allowRemoteModels? }
 *
 * @param config - 嵌入器配置字符串或对象
 * @returns BatchEmbedder 实例，或 undefined（无法解析时）
 */
export function createEmbedder(config: string | EmbedderObjectConfig): BatchEmbedder | undefined {
  const provider = typeof config === 'string' ? config : config.provider;

  if (provider === 'fastembed') {
    if (typeof config === 'object') {
      return new FastEmbedEmbedder({
        model: config.model,
        cacheDir: config.cacheDir,
        allowRemoteModels: config.allowRemoteModels,
      });
    }
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
