// @vico/agent - VectorSemanticRecall: 基于 Embedder + VectorStore 的语义召回实现
import type {Embedder, SemanticRecallMemory, VectorStore} from './types.js';
import type {MemoryRecord} from '../contracts/memory.js';
import {InMemoryVectorStore} from './in-memory-vector-store.js';

/** VectorSemanticRecall 构造选项 */
export interface VectorSemanticRecallOptions {
  /** 嵌入器，将文本转换为向量 */
  embedder: Embedder;
  /** 向量存储，未提供时使用 InMemoryVectorStore */
  vectorStore?: VectorStore;
}

/** 基于 Embedder + VectorStore 的语义召回实现 */
export class VectorSemanticRecall implements SemanticRecallMemory {
  private readonly embedder: Embedder;
  private vectorStore: VectorStore;

  constructor(options: VectorSemanticRecallOptions) {
    this.embedder = options.embedder;
    this.vectorStore = options.vectorStore ?? new InMemoryVectorStore();
  }

  async search(query: string, limit = 5): Promise<MemoryRecord[]> {
    const embedding = await this.embedder(query);
    return this.vectorStore.search(embedding, limit);
  }

  async create(record: MemoryRecord): Promise<void> {
    // 若未提供 embedding，通过 embedder 计算
    if (!record.embedding) {
      record = { ...record, embedding: await this.embedder(record.content) };
    }
    await this.vectorStore.add(record);
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    // 若 content 变更但未提供新 embedding，重新计算
    if (patch.content !== undefined && !patch.embedding) {
      patch = { ...patch, embedding: await this.embedder(patch.content) };
    }
    await this.vectorStore.update(id, patch);
  }

  async delete(id: string): Promise<void> {
    await this.vectorStore.delete(id);
  }
}
