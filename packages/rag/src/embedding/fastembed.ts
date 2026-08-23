// @vico/rag — FastEmbed local ONNX embedder
// Requires: pnpm add @huggingface/transformers
// Gracefully degrades if not installed.

import type { BatchEmbedder, BatchEmbedOptions, BatchEmbedResult } from '../types/embedder.js';

export interface FastEmbedOptions {
  model?: string;
  /** transformers.js 模型缓存目录（默认 ~/.cache/huggingface） */
  cacheDir?: string;
  /** 是否允许从 Hugging Face Hub 下载模型；false 则仅用本地缓存（离线模式） */
  allowRemoteModels?: boolean;
}

/**
 * FastEmbedEmbedder — 本地 ONNX 嵌入。
 *
 * 依赖 @huggingface/transformers（peerDependency）。
 * 未安装时 doEmbed 抛出明确错误。
 */
export class FastEmbedEmbedder implements BatchEmbedder {
  private model?: string;
  private cacheDir?: string;
  private allowRemoteModels?: boolean;
  private extractorPromise?: Promise<unknown>;

  constructor(options: FastEmbedOptions = {}) {
    this.model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
    this.cacheDir = options.cacheDir;
    this.allowRemoteModels = options.allowRemoteModels;
    // 构造时即启动模型加载（后台不阻塞）——模型下载重，若延迟到首次嵌入才加载会导致该请求超时
    this.extractorPromise = this.loadModel();
  }

  /**
   * 加载 ONNX 模型。永不 reject —— 失败时返回 Error 对象，交由 doEmbed 统一抛出，
   * 避免构造期后台加载产生 unhandled rejection。
   */
  private async loadModel(): Promise<unknown> {
    try {
      // @ts-ignore — @huggingface/transformers is an optional peerDependency, may not be installed
      const { pipeline, env } = await import('@huggingface/transformers');
      // 应用可选配置（缓存目录 / 离线模式），需在 pipeline 加载前设置
      if (this.cacheDir) env.cacheDir = this.cacheDir;
      if (this.allowRemoteModels !== undefined) env.allowRemoteModels = this.allowRemoteModels;
      return await pipeline('feature-extraction', this.model);
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        return new Error(
          'FastEmbedEmbedder requires @huggingface/transformers.\n' +
          'Install: pnpm add @huggingface/transformers'
        );
      }
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  async doEmbed(options: BatchEmbedOptions): Promise<BatchEmbedResult> {
    const extractor = await this.extractorPromise!;
    if (extractor instanceof Error) {
      throw extractor;
    }

    const embeddings: number[][] = [];
    for (const value of options.values) {
      const result = await (extractor as any)(value, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(result.data as Float32Array));
    }

    return { embeddings };
  }
}
