import type { Message } from './agent.js';

/**
 * 短期记忆 — 滑动 FIFO 窗口。
 */
export interface ShortTermMemory {
  /** 添加消息到指定 thread 的记忆窗口 */
  push(threadId: string, message: Message): void;
  /** 获取最近 window 条消息 */
  get(threadId: string, window: number): Message[];
  /** 清空指定 thread 的短期记忆 */
  clear(threadId: string): void;
}

/**
 * 长期记忆记录。
 */
export interface MemoryRecord {
  id: string;
  content: string;
  scope: 'user' | 'workspace' | 'thread';
  tags: string[];
  confidence: number;
  tenantId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 长期记忆 — 向量检索 + 持久存储。
 */
export interface LongTermMemory {
  search(query: string, tenantId: string, limit?: number): Promise<MemoryRecord[]>;
  create(record: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryRecord>;
  update(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord>;
  delete(id: string): Promise<void>;
}

/**
 * RAG 检索结果块。
 */
export interface RagChunk {
  id: string;
  content: string;
  score: number;
  documentId: string;
  knowledgeBaseId: string;
}

/**
 * RAG 知识库 — 文档分块 + 混合搜索。
 */
export interface RagManager {
  search(query: string, knowledgeBaseIds: string[], limit?: number): Promise<RagChunk[]>;
}

/**
 * MemoryStore — 统一记忆系统端口。
 */
export interface MemoryStore {
  stm: ShortTermMemory;
  ltm: LongTermMemory;
  rag: RagManager;
}
