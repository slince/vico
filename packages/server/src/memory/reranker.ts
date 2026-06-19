/**
 * Reranker — 使用 Cross-Encoder 对检索结果二次打分重排序。
 *
 * 基于 Transformers.js，动态导入可选依赖，未安装时优雅降级返回原始结果。
 * 启动交叉编码器重排序：
 *   pnpm add @xenova/transformers
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
    const { pipeline } = await import('@xenova/transformers');
    const reranker = await pipeline('text-classification', modelName);

    // 逐对评分：Cross-Encoder 对 (query, doc) 对逐一计算相关性分数
    const reranked: SearchResult[] = [];
    for (const r of results) {
      const output = await (reranker as any)(query, {
        text_pair: r.content.substring(0, 512),
      });
      const score = output?.score ?? 0;
      reranked.push({ ...r, score });
    }

    return reranked.sort((a, b) => b.score - a.score);
  } catch (err: any) {
    // @xenova/transformers 未安装或模型加载失败，优雅降级
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      logger.warn('Reranker: @xenova/transformers not installed. Install with: pnpm add @xenova/transformers');
    } else {
      logger.warn({ err }, 'Rerank failed, returning original order');
    }
    return results;
  }
}
