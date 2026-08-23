// @vico/core - Memory module type definitions

export interface MemoryRecord {
  id: string;
  threadId?: string;
  /** 记忆归属用户（单租户内按 userId 隔离长期记忆） */
  scopeId?: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** 语义搜索结果 — 在 MemoryRecord 基础上附带相似度分数 */
export interface MemorySearchResult extends MemoryRecord {
  /** 余弦相似度（约 -1~1，越大越相关） */
  score: number;
}

/** 语义召回记忆 — 基于向量检索的长期记忆 */
export interface SemanticRecallMemory {
  /**
   * 按语义搜索记忆记录。
   *
   * @param scopeId - 用户级隔离标识；提供时仅召回该用户的记忆
   */
  search(query: string, limit?: number, scopeId?: string): Promise<MemorySearchResult[]>;
  /** 创建记忆记录 */
  create(record: MemoryRecord): Promise<void>;
  /** 更新记忆记录 */
  update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
  /** 删除记忆记录 */
  delete(id: string): Promise<void>;
}

/** 工作记忆 — 模板驱动的用户事实存储，LLM 自主更新 */
export interface WorkingMemory {
  /** 获取当前工作记忆内容（Markdown） */
  get(scopeId: string): Promise<string>;
  /** 全量替换工作记忆内容 */
  set(scopeId: string, content: string): Promise<void>;
  /** 获取模板（用于注入 system prompt） */
  getTemplate(): string;
}
