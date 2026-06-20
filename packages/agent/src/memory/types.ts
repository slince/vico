// @vico/agent - Memory module type definitions
import type { ModelMessage } from '../model/types.js';
import type { MemoryRecord } from '../contracts/memory.js';
/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** 三层记忆存储端口 */
export interface MemoryStore {
  /** 短期记忆（滑动窗口） */
  stm: {
    /** 向线程的会话历史追加一条消息 */
    push(threadId: string, message: ModelMessage): void;
    /** 获取线程最近 window 条消息（FIFO 滑动窗口） */
    get(threadId: string, window: number): ModelMessage[];
  };
  /** 长期记忆（向量检索） */
  ltm: {
    /** 按语义搜索记忆记录 */
    search(query: string, limit?: number): Promise<MemoryRecord[]>;
    /** 创建记忆记录 */
    create(record: MemoryRecord): Promise<void>;
    /** 更新记忆记录 */
    update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
    /** 删除记忆记录 */
    delete(id: string): Promise<void>;
  };
  /** RAG 知识库检索 */
  rag: {
    /** 在知识库中检索相关文档片段 */
    search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
  };
}
