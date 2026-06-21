// @vico/rag — Result formatting with source citation
import type { SearchResult } from '../types/retrieval.js';

/**
 * 将检索结果格式化为带引用标记的文本。
 *
 * 格式: `[source: {filename}#chunk{idx}] {content}`
 */
export function formatResults(results: SearchResult[]): string[] {
  return results.map((r) => {
    const filename = (r.metadata?.filename as string) || 'unknown';
    const idx = (r.metadata?.chunk_index as number) ?? 0;
    return `[source: ${filename}#chunk${idx}] ${r.content}`;
  });
}

/** 将结果拼接为单个上下文字符串 */
export function joinResults(formatted: string[]): string {
  return formatted.join('\n\n');
}
