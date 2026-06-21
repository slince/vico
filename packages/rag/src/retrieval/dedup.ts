// @vico/rag — Result deduplication
import type { VectorQueryResult } from '../types/vector-store.js';

/** 按 ID 去重，保留最高分的记录 */
export function dedup(results: VectorQueryResult[]): VectorQueryResult[] {
  const seen = new Map<string, VectorQueryResult>();
  for (const r of results) {
    const existing = seen.get(r.id);
    if (!existing || r.score > existing.score) {
      seen.set(r.id, r);
    }
  }
  return [...seen.values()];
}
