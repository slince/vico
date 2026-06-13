/**
 * Working Memory — 用户工作记忆
 *
 * 使用 LLM（generateObject + Zod schema）从对话中提取结构化事实和偏好。
 * 替代了原有的正则匹配方案，具备：
 * - 语义理解（否定、隐含偏好、多语言）
 * - 结构化输出（content + importance）
 * - 低温度提取（0.3），减少幻觉
 *
 * 使用 Drizzle ORM 操作 memory_entries 表（type='working'）。
 */
import { v4 as uuid } from 'uuid';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { getDb, schema } from '../../db/db.js';

const { memory_entries } = schema;

/** 提取结果类型（显式声明以兼容 zod@4 + ai@4 的类型推断） */
interface ExtractionResult {
  facts: { content: string; importance: number }[];
}

/** 提取事实的 Zod schema */
const extractionSchema = z.object({
  facts: z.array(
    z.object({
      content: z.string().describe('提取到的事实或偏好，使用用户原文语言'),
      importance: z
        .number()
        .min(0)
        .max(1)
        .describe(
          '重要性：1.0 = 强烈偏好（喜欢/讨厌/想要），0.7 = 明确陈述，0.4 = 一般信息',
        ),
    }),
  ).describe('从用户消息中提取的结构化事实列表'),
});

export class WorkingMemory {
  /**
   * 使用 LLM 从对话中提取工作记忆事实。
   *
   * 通过 generateObject + Zod schema 做结构化提取，支持：
   * - 显式偏好和事实（"我喜欢简洁回复"）
   * - 隐含偏好（"上次那个方案太复杂了" → 偏好简洁方案）
   * - 否定语义理解（"我不喜欢太啰嗦" → 不喜欢啰嗦）
   * - 多语言（中英文均可）
   *
   * 提取后通过 upsertByContent 去重存储。
   *
   * @param model - AI SDK LanguageModel 实例
   * @param tenantId - 租户 ID
   * @param userId - 用户 ID
   * @param messages - 消息数组 [{role, content}]
   */
  async extractAndStore(
    model: LanguageModel,
    tenantId: string,
    userId: string,
    messages: { role: string; content: string }[],
  ): Promise<void> {
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length === 0) return;

    const result = await generateObject({
      model,
      schema: extractionSchema,
      temperature: 0.3,
      system:
        '你是一个事实提取系统。从对话中提取用户明确陈述的关于自己的事实和偏好。\n\n' +
        '规则：\n' +
        '- 仅提取用户明确表达的信息，不推测\n' +
        '- 使用用户原文语言返回事实\n' +
        '- 忽略问题、闲聊、技术指令\n' +
        '- 强烈偏好（喜欢/讨厌/想要）importance > 0.7\n' +
        '- 事实性陈述（工作、地点、工具）importance 0.4-0.7\n' +
        '- 模糊或不清晰的跳过',
      messages: userMessages.map((m) => ({
        role: 'user' as const,
        content: m.content,
      })),
    });

    const data = result.object as unknown as ExtractionResult;

    for (const fact of data.facts) {
      await this.upsertByContent({
        tenant_id: tenantId,
        user_id: userId,
        type: 'working',
        content: fact.content,
        importance: fact.importance,
      });
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
