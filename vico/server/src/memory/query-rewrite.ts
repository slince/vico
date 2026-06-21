/**
 * QueryRewrite — 检索前通过 LLM 改写用户问题提升召回率。
 *
 * 策略：拆分复合问题 + 补充同义词 + 纠正拼写。
 * 结果缓存至内存 Map（TTL 5 分钟）。
 */
import logger from '../lib/logger.js';

interface CacheEntry {
  rewrites: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/**
 * 将用户原始问题改写为多个检索查询变体。
 *
 * 当前实现：直接返回原始查询（不依赖 LLM）。
 * 启用 LLM 改写需要配置 query_rewrite 并传入 model provider。
 * 这避免了在 memory 层引入对 AI SDK 和 model resolution 的硬依赖。
 *
 * @param query - 原始用户查询
 * @returns 改写后的查询数组（至少包含原始查询）
 */
export async function rewriteQuery(query: string): Promise<string[]> {
  // 检查缓存
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.rewrites;
  }

  // 当前策略：直接返回原始查询。
  // 后续可集成 LLM 调用进行真正的查询改写。
  const rewrites = [query];

  // 缓存
  cache.set(query, { rewrites, at: Date.now() });
  if (cache.size > 1000) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  return rewrites;
}
