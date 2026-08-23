// @vico/rag — Embedder barrel export + factory

import { FastEmbedEmbedder } from './fastembed.js';
import { OpenAIEmbedder } from './openai.js';
import type { Embedder } from '../types/embedder.js';

/** fastembed 提供方配置 */
interface FastEmbedProviderConfig {
  provider: 'fastembed';
  model?: string;
  /** 模型缓存目录（默认 ~/.cache/huggingface） */
  cacheDir?: string;
  /** 是否允许联网下载模型；false 则仅用本地缓存（离线模式） */
  allowRemoteModels?: boolean;
}

/** openai 提供方配置 */
interface OpenAIProviderConfig {
  provider: 'openai';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

/** 对象形式的嵌入器配置，按 provider 判别 */
export type EmbedderConfig = FastEmbedProviderConfig | OpenAIProviderConfig;

/**
 * 嵌入器工厂 — 从配置创建 Embedder 实例。
 *
 * 支持字符串：
 * - "fastembed" — 本地 ONNX 嵌入
 * - "openai:<baseUrl>" — OpenAI-compatible API（自定义 endpoint）
 *
 * 支持对象（按 provider 分层）：
 * - { provider: "fastembed", model?, cacheDir?, allowRemoteModels? }
 * - { provider: "openai", model?, baseUrl?, apiKey? }
 *
 * @param config - 嵌入器配置字符串或对象
 * @returns Embedder 实例（无法解析时抛出）
 */
export function createEmbedder(config: string | EmbedderConfig): Embedder {
  // string 形式
  if (typeof config === 'string') {
    if (config === 'fastembed') {
      return new FastEmbedEmbedder();
    }
    if (config.startsWith('openai:')) {
      return new OpenAIEmbedder({ baseUrl: config.slice('openai:'.length) });
    }
    throw new Error(`Unsupported embedder config: "${config}"`);
  }

  // object 形式，按 provider 判别
  if (config.provider === 'fastembed') {
    return new FastEmbedEmbedder({
      model: config.model,
      cacheDir: config.cacheDir,
      allowRemoteModels: config.allowRemoteModels,
    });
  }

  if (config.provider === 'openai') {
    return new OpenAIEmbedder({
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  }

  // 运行时兜底：provider 来自 YAML 无静态类型，可能是不支持的字符串
  throw new Error(`Unsupported embedder provider: "${(config as { provider: string }).provider}"`);
}

export { FastEmbedEmbedder, type FastEmbedOptions } from './fastembed.js';
export { OpenAIEmbedder, type OpenAIEmbedderOptions } from './openai.js';
