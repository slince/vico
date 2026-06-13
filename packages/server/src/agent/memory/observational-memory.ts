/**
 * Observational Memory — 观察记忆（长对话摘要压缩）
 *
 * 当对话消息数超过阈值时，自动生成历史摘要并存储到 memory_entries
 * 表（type='observation'）。后续对话时，摘要作为额外上下文注入，
 * 替代早期消息，避免 token 窗口溢出，同时保持对话连续性。
 *
 * 设计要点：
 * - 不引入 LLM 调用做摘要（Phase 3 MVP 级别），采用规则拼接
 * - 阈值：config.memory.stm_window * 2 条消息后触发
 * - 摘要存储为 memory_entries（type='observation'），conversation_id 嵌入 content 中
 * - 检索时按 conversation_id 前缀匹配
 */
import { v4 as uuid } from 'uuid';
import { getSqlite } from '../../db/db.js';
import { config } from '../../config.js';

export class ObservationalMemory {
  private readonly compressThreshold: number;

  constructor() {
    this.compressThreshold = (config.memory.stm_window || 20) * 2;
  }

  /**
   * 检查并执行对话摘要压缩
   *
   * 从 messages 表获取指定 conversation 的消息数，超过阈值时生成摘要。
   * 摘要内容为最近 N 条消息的拼接（不含工具调用），避免上下文窗口溢出。
   *
   * @param tenantId - 租户 ID
   * @param conversationId - 对话 ID
   * @returns 是否执行了压缩
   */
  async maybeCompress(tenantId: string, conversationId: string): Promise<boolean> {
    const db = getSqlite();

    const countRow = db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
    ).get(conversationId) as { count: number };

    if (countRow.count < this.compressThreshold) return false;

    const recentMessages = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(conversationId, this.compressThreshold) as { role: string; content: string }[];

    const summary = recentMessages
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    const id = uuid();
    db.prepare(
      `INSERT INTO memory_entries (id, tenant_id, user_id, type, content, importance, created_at)
       VALUES (?, ?, '', 'observation', ?, 0.3, ?)`
    ).run(id, tenantId, `[Conversation ${conversationId}]\n${summary}`, Date.now());

    return true;
  }

  /**
   * 检索对话的观察记忆摘要
   *
   * @param tenantId - 租户 ID
   * @param conversationId - 对话 ID
   * @param limit - 返回条目上限
   * @returns 最近的观察记忆条目列表
   */
  async retrieve(tenantId: string, conversationId: string, limit: number = 3) {
    const db = getSqlite();
    const rows = db.prepare(
      `SELECT * FROM memory_entries
       WHERE tenant_id = ? AND type = 'observation' AND content LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(tenantId, `%[Conversation ${conversationId}]%`, limit);
    return rows;
  }

  /**
   * 将观察记忆格式化为 prompt 片段
   *
   * 移除内部标签前缀 [Conversation ...]，只保留摘要内容。
   */
  retrieveAsPrompt(rows: any[]): string {
    if (rows.length === 0) return '';
    const summaries = rows.map((r: any) => {
      const content = (r.content as string).replace(/^\[Conversation .+\]\n?/, '');
      return content;
    });
    return '## 对话历史摘要\n' + summaries.join('\n---\n');
  }
}

export const observationalMemory = new ObservationalMemory();
