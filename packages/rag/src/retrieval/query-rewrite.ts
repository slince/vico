// @vico/rag — Query rewriting for improved recall

import type { QueryRewriter } from '../types/retrieval.js';

interface CacheEntry {
  rewrites: string[];
  at: number;
}

/** 查询改写缓存 TTL (ms) */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * DefaultQueryRewriter — 查询改写的默认实现。
 *
 * 当前策略：返回原始查询（无 LLM 依赖）。
 * 可通过 injection 替换为 LLM 驱动的实现：
 *
 * @example
 * ```ts
 * const llmRewriter = new DefaultQueryRewriter(async (query) => {
 *   const response = await llm.complete(`Rewrite: ${query}`);
 *   return [query, ...response.split('\n')];
 * });
 * ```
 */
export class DefaultQueryRewriter implements QueryRewriter {
  private cache = new Map<string, CacheEntry>();
  private llmRewriter?: (query: string) => Promise<string[]>;

  constructor(llmRewriter?: (query: string) => Promise<string[]>) {
    this.llmRewriter = llmRewriter;
  }

  async rewrite(query: string): Promise<string[]> {
    // 检查缓存
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      return cached.rewrites;
    }

    let rewrites: string[];
    if (this.llmRewriter) {
      try {
        rewrites = await this.llmRewriter(query);
      } catch {
        rewrites = [query];
      }
    } else {
      // 无 LLM 注入时，返回原始查询
      rewrites = [query];
    }

    // 缓存
    this.cache.set(query, { rewrites, at: Date.now() });
    if (this.cache.size > 1000) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    return rewrites;
  }
}
