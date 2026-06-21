// @vico/rag — FastEmbed local ONNX embedder (stub)
// Requires: pnpm add @xenova/transformers or similar ONNX runtime
// Gracefully degrades if not installed.

import type { BatchEmbedder, BatchEmbedOptions, BatchEmbedResult } from '../types/embedder.js';

export interface FastEmbedOptions {
  model?: string;
}

/**
 * FastEmbedEmbedder — 本地 ONNX 嵌入。
 *
 * 依赖 @xenova/transformers（peerDependency）。
 * 未安装时 doEmbed 抛出明确错误。
 */
export class FastEmbedEmbedder implements BatchEmbedder {
  private model?: string;

  constructor(options: FastEmbedOptions = {}) {
    this.model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
  }

  async doEmbed(options: BatchEmbedOptions): Promise<BatchEmbedResult> {
    try {
      // @ts-ignore — @xenova/transformers is an optional peerDependency, may not be installed
      const { pipeline } = await import('@xenova/transformers');
      const extractor = await pipeline('feature-extraction', this.model);
      const embeddings: number[][] = [];

      for (const value of options.values) {
        const result = await (extractor as any)(value, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(result.data as Float32Array));
      }

      return { embeddings };
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'FastEmbedEmbedder requires @xenova/transformers.\n' +
          'Install: pnpm add @xenova/transformers'
        );
      }
      throw err;
    }
  }
}
