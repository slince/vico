/**
 * Working Memory — 用户工作记忆
 *
 * 管理系统自动提取的用户事实、偏好、上下文信息。
 * 使用 Drizzle ORM 操作 memory_entries 表（type='working'）。
 *
 * 不同于 LTM 的向量检索（语义匹配），WorkingMemory 做精确类型检索，
 * 适合存储结构化的事实数据（如 "用户偏好简洁回复"）。
 */
import { v4 as uuid } from 'uuid';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { getDb, schema } from '../../db/db.js';

const { memory_entries } = schema;

export class WorkingMemory {
  /**
   * 从对话中提取工作记忆事实
   *
   * 使用正则匹配提取以下模式：
   * - 偏好："我喜欢/偏好/习惯/想要/希望..."
   * - 行为："以后/下次/将来..."
   * - 身份："我是/叫/在/做..."
   *
   * 提取后通过 upsertByContent 存储（去重更新），
   * 类型标记为 'working'。
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param messages - 消息数组 [{role, content}]
   */
  async extractAndStore(
    tenantId: string,
    userId: string,
    messages: { role: string; content: string }[],
  ): Promise<void> {
    // 否定标记 — 匹配到否定时跳过提取
    const negationMarkers = [
      /不(?:喜欢|偏好|习惯|想要|希望|太|想|会|要|能)/,
      /(?:不要|不想|别|从不|再也不|别再)/,
      /(?:don't|do not|never|won't|can't|cannot)\s/i,
      /not\s(?:really|particularly|a\s*fan\s*of)/i,
    ];

    function isNegated(text: string): boolean {
      return negationMarkers.some((r) => r.test(text));
    }

    const patterns: { regex: RegExp; type: 'working'; importance: number }[] = [
      // 中文偏好
      { regex: /我(?:喜欢|偏好|习惯|想要|希望|更倾向于)(.+)/, type: 'working', importance: 0.8 },
      { regex: /(?:以后|下次|将来|每次)(.+)/, type: 'working', importance: 0.6 },
      { regex: /我(?:是|叫|在|做|使用)(.+)/, type: 'working', importance: 0.5 },
      // 英文偏好
      { regex: /I\s(?:like|prefer|love|enjoy|want|hope|wish)\s+(.+)/i, type: 'working', importance: 0.8 },
      { regex: /(?:in the future|going forward|from now on|next time)\s*,?\s*(.+)/i, type: 'working', importance: 0.6 },
      { regex: /I\s(?:am|work\s*as|use|live\sin)\s+(.+)/i, type: 'working', importance: 0.5 },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const { regex, type, importance } of patterns) {
        const match = msg.content.match(regex);
        if (match && match[1] && match[1].trim().length > 1) {
          const fact = match[1].trim();
          // 跳过否定句式：检查完整的匹配文本而非仅捕获组
          if (isNegated(match[0])) continue;
          await this.upsertByContent({
            tenant_id: tenantId,
            user_id: userId,
            type,
            content: fact,
            importance,
          });
        }
      }
    }
  }

  /**
   * 检索用户的工作记忆
   *
   * 返回该用户所有 type='working' 的条目，按 importance 降序排列。
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param limit - 返回条目上限
   * @returns 记忆条目数组
   */
  async retrieve(tenantId: string, userId: string, limit: number = 10) {
    return this.searchByType(tenantId, userId, 'working', limit);
  }

  /**
   * 将工作记忆格式化为 prompt 片段
   *
   * 可直接拼接到系统提示词中。
   */
  async retrieveAsPrompt(tenantId: string, userId: string): Promise<string> {
    const entries = await this.retrieve(tenantId, userId);
    if (entries.length === 0) return '';
    return '## 用户信息\n' + entries.map((e) => `- ${String(e.content)}`).join('\n');
  }

  /**
   * 按类型检索记忆条目
   */
  private async searchByType(
    tenantId: string,
    userId: string,
    type: string | string[],
    limit: number = 20,
  ) {
    const db = getDb();
    const types = Array.isArray(type) ? type : [type];
    return db.select().from(memory_entries)
      .where(and(
        eq(memory_entries.tenant_id, tenantId),
        eq(memory_entries.user_id, userId),
        inArray(memory_entries.type, types),
      ))
      .orderBy(desc(memory_entries.importance), desc(memory_entries.created_at))
      .limit(limit)
      .all();
  }

  /**
   * 按内容+类型覆盖写入记忆（去重更新）
   * 同 tenant + user + type + 内容前 120 字符匹配时更新，否则插入。
   */
  private async upsertByContent(
    entry: { tenant_id: string; user_id: string; type: string; content: string; importance: number },
  ): Promise<void> {
    const db = getDb();
    const contentKey = entry.content.slice(0, 120);
    const existing = await db.select({ id: memory_entries.id }).from(memory_entries)
      .where(and(
        eq(memory_entries.tenant_id, entry.tenant_id),
        eq(memory_entries.user_id, entry.user_id),
        eq(memory_entries.type, entry.type),
        sql`substr(${memory_entries.content}, 1, 120) = ${contentKey}`,
      ))
      .limit(1)
      .all();

    if (existing.length > 0) {
      await db.update(memory_entries)
        .set({ content: entry.content, importance: entry.importance })
        .where(eq(memory_entries.id, existing[0].id))
        .run();
    } else {
      await db.insert(memory_entries).values({
        id: uuid(),
        tenant_id: entry.tenant_id,
        user_id: entry.user_id,
        type: entry.type,
        content: entry.content,
        importance: entry.importance,
        created_at: Date.now(),
      }).run();
    }
  }
}

export const workingMemory = new WorkingMemory();
