// src/memory/in-memory-rag-provider.ts
import type { RagProvider, RagChunk } from '../types.js';

/** 基于 Map 关键词匹配的内存版 RAG 检索 */
export class InMemoryRagProvider implements RagProvider {
  private chunks: Map<string, RagChunk[]> = new Map();

  async search(query: string, knowledgeBaseId: string, limit = 5): Promise<RagChunk[]> {
    const list = this.chunks.get(knowledgeBaseId) ?? [];
    const q = query.toLowerCase();
    return list.filter((c) => c.content.toLowerCase().includes(q)).slice(0, limit);
  }
}
