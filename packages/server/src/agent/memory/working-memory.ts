/**
 * Working Memory — 用户工作记忆
 *
 * 管理系统自动提取的用户事实、偏好、上下文信息。
 * 直接操作 memory_entries 表（type='working'），使用 libsql 异步客户端。
 *
 * 不同于 LTM 的向量检索（语义匹配），WorkingMemory 做精确类型检索，
 * 适合存储结构化的事实数据（如 "用户偏好简洁回复"）。
 */
import { v4 as uuid } from 'uuid';
import { getClient } from '../../db/db.js';

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
    const patterns: { regex: RegExp; type: 'working'; importance: number }[] = [
      { regex: /我(?:喜欢|偏好|习惯|想要|希望|更倾向于)(.+)/, type: 'working', importance: 0.8 },
      { regex: /(?:以后|下次|将来|每次)(.+)/, type: 'working', importance: 0.6 },
      { regex: /我(?:是|叫|在|做|使用)(.+)/, type: 'working', importance: 0.5 },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const { regex, type, importance } of patterns) {
        const match = msg.content.match(regex);
        if (match && match[1] && match[1].trim().length > 1) {
          const fact = match[1].trim();
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
   * 直接查询 memory_entries 表。
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
    return '## 用户信息\n' + entries.map((e: Record<string, unknown>) => `- ${String(e.content)}`).join('\n');
  }

  /**
   * 按类型检索记忆条目
   *
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param type - 记忆类型或类型数组
   * @param limit - 返回条目上限
   */
  private async searchByType(
    tenantId: string,
    userId: string,
    type: string | string[],
    limit: number = 20,
  ) {
    const client = getClient();
    const types = Array.isArray(type) ? type : [type];
    const placeholders = types.map(() => '?').join(',');
    const rs = await client.execute({
      sql: `SELECT * FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type IN (${placeholders})
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
      args: [tenantId, userId, ...types, limit],
    });
    return rs.rows.map((r) => {
      const row: Record<string, unknown> = {};
      for (let i = 0; i < rs.columns.length; i++) {
        row[rs.columns[i]] = r[i];
      }
      return row;
    });
  }

  /**
   * 按内容+类型覆盖写入记忆（去重更新）
   * 同 tenant + user + type + 内容前 120 字符匹配时更新，否则插入。
   */
  private async upsertByContent(
    entry: { tenant_id: string; user_id: string; type: string; content: string; importance: number },
  ): Promise<void> {
    const client = getClient();
    const contentKey = entry.content.slice(0, 120);
    const existing = await client.execute({
      sql: `SELECT id FROM memory_entries
       WHERE tenant_id = ? AND user_id = ? AND type = ? AND substr(content, 1, 120) = ?
       LIMIT 1`,
      args: [entry.tenant_id, entry.user_id, entry.type, contentKey],
    });

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0][0] as string;
      await client.execute({
        sql: `UPDATE memory_entries SET content = ?, importance = ? WHERE id = ?`,
        args: [entry.content, entry.importance, existingId],
      });
    } else {
      const id = uuid();
      await client.execute({
        sql: `INSERT INTO memory_entries (id, tenant_id, user_id, type, content, importance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, entry.tenant_id, entry.user_id, entry.type, entry.content, entry.importance, Date.now()],
      });
    }
  }
}

export const workingMemory = new WorkingMemory();
