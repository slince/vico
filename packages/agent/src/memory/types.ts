// @vico/agent - Memory module type definitions
import {z} from 'zod';

export const MemoryRecordSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().optional(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

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

/** 工作记忆 — 模板驱动的用户事实存储，LLM 自主更新 */
export interface WorkingMemory {
  /** 作用域 */
  readonly scope: 'user' | 'workspace';
  /** 获取当前工作记忆内容（Markdown） */
  get(scopeId: string): Promise<string>;
  /** 全量替换工作记忆内容 */
  set(scopeId: string, content: string): Promise<void>;
  /** 获取模板（用于注入 system prompt） */
  getTemplate(): string;
}
