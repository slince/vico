import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/db.js';
import { resourceId as buildResourceId } from '../../lib/resource.js';
import { DrizzleThreadStore, ensureTables } from '@vico/libsql-adapter';
import type { ConversationItem, ConversationDetail, MessageItem, RecentConversation } from './types.js';

const { agents } = schema;

/**
 * 从消息中提取纯文本内容。
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

/** 获取或创建共享的 ThreadStore 实例 */
async function getThreadStore(): Promise<DrizzleThreadStore> {
  const db = getDb();
  await ensureTables(db as any);
  return new DrizzleThreadStore({ db: db as any });
}

class ConversationManager {
  private threadToConversation(thread: any): ConversationItem {
    const meta = (thread.metadata || {}) as Record<string, unknown>;

    return {
      id: thread.id,
      tenant_id: (thread.resourceId as string)?.split(':')[0] ?? '',
      agent_id: thread.agentId || (meta.agent_id as string) || '',
      user_id: (meta.user_id as string) || '',
      title: thread.title || '',
      model_name: (meta.model_name as string) || '',
      message_count: 0,
      total_tokens: 0,
      created_at: thread.createdAt || Date.now(),
      updated_at: thread.updatedAt || Date.now(),
    };
  }

  async list(
    tenantId: string,
    userId: string,
    filters?: { search?: string; agent_id?: string },
  ): Promise<ConversationItem[]> {
    const search = filters?.search?.toLowerCase();
    const agentIdFilter = filters?.agent_id;
    const store = await getThreadStore();
    const threads = await store.listThreads();

    let convs: ConversationItem[] = [];
    for (const thread of threads) {
      const conv = this.threadToConversation(thread);
      if (agentIdFilter && conv.agent_id !== agentIdFilter) continue;

      try {
        const entries = await store.getEntries(thread.id);
        conv.message_count = entries.length;
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

  async getById(tenantId: string, userId: string, id: string): Promise<ConversationDetail | null> {
    const store = await getThreadStore();
    const thread = await store.getThread(id);
    if (!thread) return null;

    const conv = this.threadToConversation(thread);

    let messages: MessageItem[] = [];
    try {
      const entries = await store.getEntries(id);
      conv.message_count = entries.length;

      messages = entries.map((msg: any) => ({
        id: msg.id,
        thread_id: msg.threadId || id,
        role: ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'system',
        content: extractMessageText(msg),
        tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : undefined,
        token_usage: 0,
        created_at: msg.createdAt || Date.now(),
      }));
    } catch {
      conv.message_count = 0;
    }

    return { ...conv, messages };
  }

  async count(tenantId: string, userId: string): Promise<number> {
    const store = await getThreadStore();
    const threads = await store.listThreads();
    return threads.length;
  }

  async recent(tenantId: string, userId: string, limit = 5): Promise<RecentConversation[]> {
    const store = await getThreadStore();
    const threads = (await store.listThreads()).slice(0, limit);

    const items: RecentConversation[] = [];
    for (const thread of threads) {
      let agentName: string | undefined;
      const agentId = thread.agentId;
      if (agentId) {
        const db = getDb();
        const agent = await db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, agentId))
          .get();
        agentName = agent?.name;
      }

      let lastMessage: string | undefined;
      let messageCount = 0;
      try {
        const entries = await store.getEntries(thread.id);
        messageCount = entries.length;
        if (entries.length > 0) {
          const last = entries[entries.length - 1];
          lastMessage = extractMessageText(last) || undefined;
        }
      } catch {}

      items.push({
        id: thread.id,
        title: thread.title || '',
        agent_name: agentName,
        message_count: messageCount,
        last_message: lastMessage,
        updated_at: thread.updatedAt || Date.now(),
      });
    }

    return items;
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // ThreadStore has no delete method; drop via raw SQL
    const db = getDb();
    const store = await getThreadStore();
    const thread = await store.getThread(id);
    if (!thread) return false;

    try {
      await (db as any).run('DELETE FROM messages WHERE thread_id = ?', [id]);
      await (db as any).run('DELETE FROM turns WHERE thread_id = ?', [id]);
      await (db as any).run('DELETE FROM threads WHERE id = ?', [id]);
      return true;
    } catch {
      return false;
    }
  }
}

export const conversationManager = new ConversationManager();
