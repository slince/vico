// @vico/agent - Memory module type definitions
import type { ModelMessage } from '../model/types.js';
import type { MemoryRecord } from '../contracts/memory.js';

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** RAG 知识库检索端口 */
export interface RagProvider {
  search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
}

/** 会话历史记忆 — 基于 FIFO 滑动窗口的对话历史管理 */
export interface ConversationHistoryMemory {
  /** 向线程的会话历史追加一条消息 */
  push(threadId: string, message: ModelMessage): Promise<void>;
  /** 获取线程最近 window 条消息（FIFO 滑动窗口） */
  get(threadId: string, window: number): Promise<ModelMessage[]>;
}

/** 语义召回记忆 — 基于向量检索的长期记忆 */
export interface SemanticRecallMemory {
  /** 按语义搜索记忆记录 */
  search(query: string, limit?: number): Promise<MemoryRecord[]>;
  /** 创建记忆记录 */
  create(record: MemoryRecord): Promise<void>;
  /** 更新记忆记录 */
  update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
  /** 删除记忆记录 */
  delete(id: string): Promise<void>;
}

/** 工作记忆 — 对话期间的临时实体/键值存储 */
export interface WorkingMemory {
  /** 设置实体 */
  set(key: string, value: unknown): Promise<void>;
  /** 获取实体 */
  get(key: string): Promise<unknown | undefined>;
  /** 删除实体 */
  delete(key: string): Promise<void>;
  /** 列出所有实体键 */
  keys(): Promise<string[]>;
  /** 清空全部实体 */
  clear(): Promise<void>;
}

