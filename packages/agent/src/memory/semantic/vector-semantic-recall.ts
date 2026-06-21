// @vico/agent - VectorSemanticRecall: 基于 @vico/rag BatchEmbedder + VectorStore 的语义召回实现
import type { BatchEmbedder } from '../types.js';
import type { SemanticRecallMemory, VectorStore } from '../types.js';
import type { MemoryRecord } from '../types.js';
import { RagVectorStore } from './rag-vector-store.js';

/** VectorSemanticRecall 构造选项 */
export interface VectorSemanticRecallOptions {
  /** 批量嵌入器，将文本转换为向量 */
  embedder: BatchEmbedder;
  /** 向量存储，未提供时使用 RagVectorStore（基于 @vico/rag） */
  vectorStore?: VectorStore;
}

/** 基于 BatchEmbedder + VectorStore 的语义召回实现 */
export class VectorSemanticRecall implements SemanticRecallMemory {
  private readonly embedder: BatchEmbedder;
  private vectorStore: VectorStore;

  constructor(options: VectorSemanticRecallOptions) {
    this.embedder = options.embedder;
    this.vectorStore = options.vectorStore ?? new RagVectorStore();
  }

  async search(query: string, limit = 5): Promise<MemoryRecord[]> {
    const { embeddings } = await this.embedder.doEmbed({ values: [query] });
    return this.vectorStore.search(embeddings[0], limit);
  }

  async create(record: MemoryRecord): Promise<void> {
    if (!record.embedding) {
      const { embeddings } = await this.embedder.doEmbed({ values: [record.content] });
      record = { ...record, embedding: embeddings[0] };
    }
    await this.vectorStore.add(record);
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    if (patch.content !== undefined && !patch.embedding) {
      const { embeddings } = await this.embedder.doEmbed({ values: [patch.content] });
      patch = { ...patch, embedding: embeddings[0] };
    }
    await this.vectorStore.update(id, patch);
  }

  async delete(id: string): Promise<void> {
    await this.vectorStore.delete(id);
  }
}
