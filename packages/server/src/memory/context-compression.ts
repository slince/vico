/**
 * ContextCompression — 当检索结果过长时，通过 LLM 摘要压缩控制 Token 成本。
 */
import type { SearchResult } from './reranker.js';
import logger from '../lib/logger.js';

const MAX_CONTEXT_CHARS = 6000; // ~1.5K tokens

/**
 * 压缩检索结果，避免上下文过长。
 *
 * 当结果总长度 <= MAX_CONTEXT_CHARS 时直接返回原文；
 * 超出时截断并标记。后续可集成 LLM 摘要压缩。
 *
 * @param results - 原始检索结果数组
 * @param query - 用户查询（用于 LLM 压缩，预留）
 * @returns 压缩后的文本字符串
 */
export async function compressChunks(
  results: SearchResult[],
  query: string,
): Promise<string> {
  const fullText = results
    .map((r) => {
      const src = r.metadata?.filename || 'unknown';
      return `[${src}] ${r.content}`;
    })
    .join('\n\n');

  if (fullText.length <= MAX_CONTEXT_CHARS) return fullText;

  // 简单截断策略（后续可集成 LLM 摘要）
  logger.warn({ totalLen: fullText.length }, 'Context too long, truncating');
  return fullText.substring(0, MAX_CONTEXT_CHARS) + '\n\n[内容已截断...]';
}
