// @vico/rag — RetrievalPipeline: orchestrates search → filter → dedup → rerank → format

import type { Embedder } from '../types/embedder.js';
import type { VectorStore, VectorQueryResult } from '../types/vector-store.js';
import type { Reranker } from '../types/reranker.js';
import type { QueryRewriter, SearchOptions, SearchResult, RetrievalPipeline } from '../types/retrieval.js';
import { DEFAULT_RAG_CONFIG } from '../types/config.js';
import { dedup } from './dedup.js';
import { DefaultQueryRewriter } from './query-rewrite.js';

export interface PipelineOptions {
  embedder: Embedder;
  vectorStore: VectorStore;
  reranker?: Reranker;
  queryRewriter?: QueryRewriter;
}

/**
 * DefaultRetrievalPipeline — 标准检索管道实现。
 *
 * 流程：query rewrite → embed → vector search → filter → dedup → rerank → format
 */
export class DefaultRetrievalPipeline implements RetrievalPipeline {
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private reranker?: Reranker;
  private queryRewriter: QueryRewriter;

  constructor(options: PipelineOptions) {
    this.embedder = options.embedder;
    this.vectorStore = options.vectorStore;
    this.reranker = options.reranker;
    this.queryRewriter = options.queryRewriter ?? new DefaultQueryRewriter();
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const cfg = DEFAULT_RAG_CONFIG;
    const topK = options.topK ?? cfg.retrieval.topK;
    const threshold = options.similarityThreshold ?? cfg.retrieval.similarityThreshold;
    const enableRewrite = options.enableRewrite ?? cfg.queryRewrite.enabled;
    const enableRerank = options.enableRerank ?? cfg.rerank.enabled;

    // 1. Query rewrite（可选）
    let queries = [options.query];
    if (enableRewrite) {
      queries = await this.queryRewriter.rewrite(options.query);
    }

    // 2. 对每个查询变体执行向量搜索
    const allResults: VectorQueryResult[] = [];
    for (const q of queries) {
      const { embeddings } = await this.embedder.doEmbed({ values: [q] });
      const results = await this.vectorStore.query({
        indexName: options.indexName,
        queryVector: embeddings[0],
        topK: topK * 3,  // 多取候选用于 rerank
        filter: options.filter,
      });
      allResults.push(...results);
    }

    // 3. 相似度阈值过滤
    const filtered = allResults.filter((r) => r.score >= threshold);

    if (filtered.length === 0) return [];

    // 4. 去重 + 排序
    let results = dedup(filtered).sort((a, b) => b.score - a.score);

    // 5. Rerank（可选）
    if (enableRerank && this.reranker && results.length > 1) {
      try {
        results = await this.reranker.rerank(options.query, results);
      } catch {
        // rerank 失败静默降级
      }
    }

    // 6. 截断到 topK
    results = results.slice(0, topK);

    // 7. 映射为 SearchResult
    return results.map((r) => ({
      id: r.id,
      content: (r.metadata?.content as string) || '',
      score: r.score,
      metadata: r.metadata,
    }));
  }
}
