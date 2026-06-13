/**
 * Working Memory — 用户工作记忆
 *
 * 管理系统自动提取的用户事实、偏好、上下文信息。
 * 使用 memory_entries 表的 type='working' 存储，通过 longTermMemory 的
 * searchByType/upsertByContent 方法进行读写。
 *
 * 不同于 LTM 的向量检索（语义匹配），WorkingMemory 做精确类型检索，
 * 适合存储结构化的事实数据（如 "用户偏好简洁回复"）。
 */
import { longTermMemory } from '../../memory/long-term.js';

export class WorkingMemory {
  /**
   * 从对话中提取工作记忆事实
   *
   * 使用正则匹配提取以下模式：
   * - 偏好："我喜欢/偏好/习惯/想要/希望..."
   * - 行为："以后/下次/将来..."
   * - 身份："我是/叫/在/做..."
   *
   * 提取后通过 longTermMemory.upsertByContent 存储（去重更新），
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
          await longTermMemory.upsertByContent({
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
    return longTermMemory.searchByType(tenantId, userId, 'working', limit);
  }

  /**
   * 将工作记忆格式化为 prompt 片段
   *
   * 可直接拼接到系统提示词中。
   */
  async retrieveAsPrompt(tenantId: string, userId: string): Promise<string> {
    const entries = await this.retrieve(tenantId, userId);
    if (entries.length === 0) return '';
    return '## 用户信息\n' + entries.map((e: { content: string }) => `- ${e.content}`).join('\n');
  }
}

export const workingMemory = new WorkingMemory();
