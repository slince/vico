// @vico/rag — FastEmbed local ONNX embedder
// Requires: pnpm add @huggingface/transformers
// Gracefully degrades if not installed.

import type { BatchEmbedder, BatchEmbedOptions, BatchEmbedResult } from '../types/embedder.js';

export interface FastEmbedOptions {
  model?: string;
}

/**
 * FastEmbedEmbedder — 本地 ONNX 嵌入。
 *
 * 依赖 @huggingface/transformers（peerDependency）。
 * 未安装时 doEmbed 抛出明确错误。
 */
export class FastEmbedEmbedder implements BatchEmbedder {
  private model?: string;
  private extractor?: unknown;

  constructor(options: FastEmbedOptions = {}) {
    this.model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
  }

  async doEmbed(options: BatchEmbedOptions): Promise<BatchEmbedResult> {
    try {
      // 首次嵌入时才加载 ONNX 模型并缓存，之后复用 — 模型加载重（数百 MB / 数秒），避免每次请求重复加载
      if (!this.extractor) {
        // @ts-ignore — @huggingface/transformers is an optional peerDependency, may not be installed
        const { pipeline } = await import('@huggingface/transformers');
        this.extractor = await pipeline('feature-extraction', this.model);
      }
      const embeddings: number[][] = [];

      for (const value of options.values) {
        const result = await (this.extractor as any)(value, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(result.data as Float32Array));
      }

      return { embeddings };
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'FastEmbedEmbedder requires @huggingface/transformers.\n' +
          'Install: pnpm add @huggingface/transformers'
        );
      }
      throw err;
    }
  }
}
