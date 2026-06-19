/**
 * Reranker — 使用 Cross-Encoder 对检索结果二次打分重排序。
 *
 * 基于 Transformers.js，懒加载模型。
 * 注意：需要安装 @xenova/transformers 依赖才能使用。
 */
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
    // 尝试加载 Transformers.js（可选依赖，可能未安装）
    // @ts-ignore — @xenova/transformers is an optional dependency
    const { pipeline } = await import('@xenova/transformers');
    const reranker = await pipeline('text-classification', modelName);

    const pairs = results.map((r) => ({
      text: query,
      text_pair: r.content.substring(0, 512),
    }));

    const scores = await reranker(pairs, { topk: 1 });

    const reranked = results.map((r, i) => ({
      ...r,
      score: scores[i]?.score ?? r.score,
    }));

    return reranked.sort((a, b) => b.score - a.score);
  } catch (err: any) {
    // @xenova/transformers not installed or model load failed
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('Cannot find module')) {
      logger.warn('Reranker: @xenova/transformers not installed. Install with: pnpm add @xenova/transformers');
    } else {
      logger.warn({ err }, 'Rerank failed, returning original order');
    }
    return results;
  }
}
