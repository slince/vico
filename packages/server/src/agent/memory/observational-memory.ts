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
 * - memory_entries 使用 Drizzle ORM 操作；messages 表已移交 Mastra Storage，
 *   但压缩逻辑仍需直接查询 messages 表（通过 raw SQL）
 */
import { v4 as uuid } from 'uuid';
import { eq, and, like, sql, desc } from 'drizzle-orm';
import { getClient, getDb, schema } from '../../db/db.js';
import { config } from '../../config.js';

const { memory_entries } = schema;

export class ObservationalMemory {
  private readonly compressThreshold: number;

  constructor() {
    this.compressThreshold = (config.memory.stm_window || 20) * 2;
  }

  /**
   * 检查并执行对话摘要压缩
   *
   * 从 messages 表获取指定 conversation 的消息数，超过阈值时生成摘要。
   * messages 表已移交 Mastra Storage 管理，但物理表仍存在，通过 raw SQL 查询。
   *
   * @param tenantId - 租户 ID
   * @param conversationId - 对话 ID
   * @returns 是否执行了压缩
   */
  async maybeCompress(tenantId: string, conversationId: string): Promise<boolean> {
    const client = getClient();

    const countRs = await client.execute({
      sql: `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`,
      args: [conversationId],
    });
    const countRow = countRs.rows[0];
    const count = Number(countRow[countRs.columns.indexOf('count')]);

    if (count < this.compressThreshold) return false;

    const recentRs = await client.execute({
      sql: `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      args: [conversationId, this.compressThreshold],
    });

    const roleIdx = recentRs.columns.indexOf('role');
    const contentIdx = recentRs.columns.indexOf('content');
    const recentMessages = recentRs.rows.map((r) => ({
      role: r[roleIdx] as string,
      content: r[contentIdx] as string,
    }));

    const summary = recentMessages
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    const db = getDb();
    await db.insert(memory_entries).values({
      id: uuid(),
      tenant_id: tenantId,
      user_id: '',
      type: 'observation',
      content: `[Conversation ${conversationId}]\n${summary}`,
      importance: 0.3,
      created_at: Date.now(),
    }).run();

    return true;
  }

  /**
   * 检索对话的观察记忆摘要
   */
  async retrieve(tenantId: string, conversationId: string, limit: number = 3) {
    const db = getDb();
    return db.select().from(memory_entries)
      .where(and(
        eq(memory_entries.tenant_id, tenantId),
        eq(memory_entries.type, 'observation'),
        like(memory_entries.content, `%[Conversation ${conversationId}]%`),
      ))
      .orderBy(desc(memory_entries.created_at))
      .limit(limit)
      .all();
  }

  /**
   * 将观察记忆格式化为 prompt 片段
   *
   * 移除内部标签前缀 [Conversation ...]，只保留摘要内容。
   */
  retrieveAsPrompt(rows: { content: string }[]): string {
    if (rows.length === 0) return '';
    const summaries = rows.map((r) => {
      const content = r.content.replace(/^\[Conversation .+\]\n?/, '');
      return content;
    });
    return '## 对话历史摘要\n' + summaries.join('\n---\n');
  }
}

export const observationalMemory = new ObservationalMemory();
