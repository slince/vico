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

/** 情景记忆 — 基于向量检索的用户经历/原文（episodic memory） */
export interface EpisodicMemory {
  /**
   * 按语义搜索情景记忆记录。
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

/** 语义记忆 — 模板驱动的用户事实存储（semantic memory），LLM 自主更新 */
export interface SemanticMemory {
  /** 获取当前语义记忆内容（Markdown） */
  get(scopeId: string): Promise<string>;
  /** 全量替换语义记忆内容 */
  set(scopeId: string, content: string): Promise<void>;
  /** 获取模板（用于注入 system prompt） */
  getTemplate(): string;
}

/** 程序记忆 — 沉淀可复用的行为/流程指令（procedural memory，预留，暂无实现） */
export interface ProceduralMemory {
  /** 获取当前程序记忆内容 */
  get(scopeId: string): Promise<string>;
  /** 全量替换程序记忆内容 */
  set(scopeId: string, content: string): Promise<void>;
}
