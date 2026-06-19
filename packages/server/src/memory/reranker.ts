/**
 * Reranker — 使用 Cross-Encoder 对检索结果二次打分重排序。
 *
 * 基于 Transformers.js，懒加载模型。
 * 注意：需要安装 @xenova/transformers 依赖才能使用。
 */
import { pipeline } from '@xenova/transformers';
import logger from '../lib/logger.js';

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  score: number;
}

/**
 * 对检索结果进行重排序。
 *
 * 当前实现：当 @xenova/transformers 不可用时，返回原始结果。
 * 安装依赖后可启用真正的 cross-encoder 重排序：
 *   pnpm add @xenova/transformers
 *
 * @param query - 用户查询
 * @param results - 原始检索结果
 * @param modelName - reranker 模型名称（默认 Xenova/bge-reranker-base）
 * @returns 重排序后的结果
 */
export async function rerank(
  query: string,
  results: SearchResult[],
  modelName: string = 'Xenova/bge-reranker-base',
): Promise<SearchResult[]> {
  if (results.length <= 1) return results;

  try {
    const reranker = await pipeline('text-classification', modelName);

    // 逐对评分：Cross-Encoder 对 (query, doc) 对逐一计算相关性分数
    const reranked: SearchResult[] = [];
    for (const r of results) {
      // Cross-encoder 需要 query + doc 成对计算；Transformers.js 类型签名不含 text_pair 但运行时支持
      const output = await (reranker as any)(query, {
        text_pair: r.content.substring(0, 512),
      });
      const score = output?.score ?? 0;
      reranked.push({ ...r, score });
    }

    return reranked.sort((a, b) => b.score - a.score);
  } catch (err: any) {
    logger.warn({ err }, 'Rerank failed, returning original order');
    return results;
  }
}
