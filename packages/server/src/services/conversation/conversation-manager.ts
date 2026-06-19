import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/db.js';
import { getMemory } from '../../agent/memory-setup.js';
import { resourceId as buildResourceId } from '../../lib/resource.js';
import type { ConversationItem, ConversationDetail, MessageItem, RecentConversation } from './types.js';

const { agents } = schema;

/**
 * 从 Mastra 消息中提取纯文本内容。
 * MastraDBMessage.content 是 MastraMessageContentV2 格式 { format: 2, parts, content? }。
 */
function extractMessageText(msg: any): string {
  try {
    if (typeof msg.content === 'string') return msg.content;
    const c = msg.content;
    if (c?.content && typeof c.content === 'string') return c.content;
    if (c?.parts && Array.isArray(c.parts)) {
      const texts = c.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('');
      if (texts) return texts;
    }
    return JSON.stringify(c);
  } catch {
    return '';
  }
}

/**
 * 从 Mastra 消息中提取工具调用信息。
 */
function extractToolCalls(msg: any): string | undefined {
  try {
    const c = msg.content;
    if (c?.parts && Array.isArray(c.parts)) {
      const toolParts = c.parts.filter((p: any) =>
        p.type === 'tool-invocation' || p.type === 'tool-call',
      );
      if (toolParts.length > 0) {
        return JSON.stringify(
          toolParts.map((p: any) => ({
            name: p.toolName ?? p.tool?.name,
            arguments: p.args ?? p.tool?.args ?? {},
            result: p.result ?? p.tool?.result,
          })),
        );
      }
    }
  } catch {}
  return undefined;
}

/** Mastra thread 的核心字段 */
interface MastraThread {
  id: string;
  title?: string;
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * 对话业务管理器。
 * 封装 Mastra Memory thread 查询、格式化和消息提取逻辑。
 */
class ConversationManager {
  /**
   * 将 Mastra thread 映射为前端 conversation 格式。
   * 含异步查询 agent 名称（agent 可能不存在）。
   */
  private async threadToConversation(thread: MastraThread): Promise<ConversationItem> {
    const meta = (thread.metadata || {}) as Record<string, unknown>;

    return {
      id: thread.id,
      tenant_id: (thread.resourceId as string).split(':')[0],
      agent_id: (meta.agent_id as string) || '',
      user_id: (meta.user_id as string) || '',
      title: thread.title || '',
      model_name: (meta.model_name as string) || '',
      message_count: 0,
      total_tokens: 0,
      created_at: new Date(thread.createdAt).getTime(),
      updated_at: new Date(thread.updatedAt).getTime(),
    };
  }

  /**
   * 获取对话列表。
   * 从 Mastra Memory 读取 threads，支持按 agent 过滤和关键词搜索。
   */
  async list(
    tenantId: string,
    userId: string,
    filters?: { search?: string; agent_id?: string },
  ): Promise<ConversationItem[]> {
    const search = filters?.search?.toLowerCase();
    const agentIdFilter = filters?.agent_id;
    const memory = await getMemory();
    const resourceId = buildResourceId(tenantId, userId);

    const result = await memory.listThreads({
      perPage: false,
      filter: { resourceId },
    });

    let convs: ConversationItem[] = [];
    for (const thread of result.threads) {
      const conv = await this.threadToConversation(thread);
      if (agentIdFilter && conv.agent_id !== agentIdFilter) continue;

      // 获取消息数
      try {
        const msgResult = await memory.recall({ threadId: thread.id, perPage: 1 });
        conv.message_count = msgResult.total;
      } catch {
        conv.message_count = 0;
      }
      convs.push(conv);
    }

    if (search) {
      convs = convs.filter((c) => c.title.toLowerCase().includes(search));
    }

    convs.sort((a, b) => b.updated_at - a.updated_at);
    return convs;
  }

  /**
   * 获取对话详情，含完整消息列表。
   * 校验 thread 归属（resourceId 匹配 tenantId）。
   */
  async getById(tenantId: string, userId: string, id: string): Promise<ConversationDetail | null> {
    const memory = await getMemory();
    const resourceId = buildResourceId(tenantId, userId);

    const thread = await memory.getThreadById({ threadId: id });
    if (!thread || thread.resourceId !== resourceId) return null;

    const conv = await this.threadToConversation(thread);

    let messages: MessageItem[] = [];
    try {
      const msgResult = await memory.recall({ threadId: id, perPage: false });
      conv.message_count = msgResult.total;

      messages = msgResult.messages.map((msg: any) => ({
        id: msg.id,
        thread_id: msg.thread_id || id,
        role: ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'system',
        content: extractMessageText(msg),
        tool_calls: extractToolCalls(msg),
        token_usage: 0,
        created_at: new Date(msg.createdAt).getTime(),
      }));
    } catch {
      conv.message_count = 0;
    }

    return { ...conv, messages };
  }

  /**
   * 获取租户下对话总数。
   */
  async count(tenantId: string, userId: string): Promise<number> {
    const memory = await getMemory();
    const result = await memory.listThreads({
      perPage: false,
      filter: { resourceId: buildResourceId(tenantId, userId) },
    });
    return result.threads.length;
  }

  /**
   * 获取最近 N 条对话，含最后一条消息预览。
   * Mastra listThreads 按 updatedAt 降序返回。
   */
  async recent(tenantId: string, userId: string, limit = 5): Promise<RecentConversation[]> {
    const memory = await getMemory();

    const result = await memory.listThreads({
      perPage: limit,
      filter: { resourceId: buildResourceId(tenantId, userId) },
    });

    const items: RecentConversation[] = [];
    for (const thread of result.threads) {
      const meta = (thread.metadata || {}) as Record<string, unknown>;

      // 获取 agent 名称
      let agentName: string | undefined;
      const agentId = meta.agent_id as string | undefined;
      if (agentId) {
        const db = getDb();
        const agent = await db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, agentId))
          .get();
        agentName = agent?.name;
      }

      // 获取最后一条消息预览
      let lastMessage: string | undefined;
      let messageCount = 0;
      try {
        const msgResult = await memory.recall({ threadId: thread.id, perPage: 1 });
        messageCount = msgResult.total;
        if (msgResult.messages.length > 0) {
          const last = msgResult.messages[msgResult.messages.length - 1];
          lastMessage = extractMessageText(last) || undefined;
        }
      } catch {
        // 忽略获取消息失败
      }

      items.push({
        id: thread.id,
        title: thread.title || '',
        agent_name: agentName,
        message_count: messageCount,
        last_message: lastMessage,
        updated_at: new Date(thread.updatedAt).getTime(),
      });
    }

    return items;
  }
  /**
   * 删除对话。
   * 校验 thread 归属（resourceId 匹配 tenantId）后调用 Mastra Memory deleteThread。
   * 返回 true 表示删除成功，false 表示对话不存在或无权访问。
   */
  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const memory = await getMemory();
    const resourceId = buildResourceId(tenantId, userId);
    const thread = await memory.getThreadById({ threadId: id });
    if (!thread || thread.resourceId !== resourceId) return false;
    await memory.deleteThread(id);
    return true;
  }
}

/** 对话业务管理器单例 */
export const conversationManager = new ConversationManager();
