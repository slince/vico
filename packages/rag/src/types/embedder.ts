// @vico/rag — Embedder type definitions

/** 批量嵌入请求 */
export interface BatchEmbedOptions {
  /** 待嵌入的文本列表 */
  values: string[];
  /** 模型名称（可选，用于多模型场景） */
  model?: string;
}

/** 批量嵌入结果 */
export interface BatchEmbedResult {
  /** 向量列表，与 values 一一对应 */
  embeddings: number[][];
  /** Token 用量统计 */
  usage?: { tokens: number };
}

/** 批量嵌入器 — 一次调用嵌入多段文本 */
export interface BatchEmbedder {
  doEmbed(options: BatchEmbedOptions): Promise<BatchEmbedResult>;
}
