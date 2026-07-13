import {eq} from 'drizzle-orm';
import {getDb, schema} from '../../db/db.js';
import {vico} from '../../vico.js';
import type {ConversationDetail, ConversationItem, MessageItem, RecentConversation} from './types.js';
import {Message, ThreadStore} from "@vico/agent";

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

class ConversationManager {
  /** Vico 容器的共享 ThreadStore */
  private get store(): ThreadStore {
    return vico.thread!;
  }

  private threadToConversation(thread: any): ConversationItem {
    const meta = (thread.metadata || {}) as Record<string, unknown>;

    return {
      id: thread.id,
      tenant_id: (meta.tenant_id as string) || '',
      agent_id: thread.agentId || (meta.agent_id as string) || '',
      user_id: thread.userId || (meta.user_id as string) || '',
      title: thread.title || '',
      model_name: (meta.model_name as string) || '',
      message_count: 0,
      total_tokens: 0,
      created_at: thread.createdAt || Date.now(),
      updated_at: thread.updatedAt || Date.now(),
    };
  }

  async list(
    userId: string,
    filters?: { search?: string; agent_id?: string },
  ): Promise<ConversationItem[]> {
    const search = filters?.search?.toLowerCase();
    const agentIdFilter = filters?.agent_id;
    const threads = await this.store.listThreads({ userId, agentId: agentIdFilter || undefined });

    let convs: ConversationItem[] = [];
    for (const thread of threads) {
      const conv = this.threadToConversation(thread);

      try {
        const entries = await this.store.getEntries(thread.id);
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

  async getById(userId: string, id: string): Promise<ConversationDetail | null> {
    const thread = await this.store.getThread(id);
    if (!thread) return null;

    const conv = this.threadToConversation(thread);

    const entries = await this.store.getEntries(id);
    conv.message_count = entries.length;

    const messages: MessageItem[] = entries.map((msg: Message) => ({
      id: msg.id,
      thread_id: msg.threadId || id,
      role: ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'system',
      content: extractMessageText(msg),
      tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : undefined,
      token_usage: 0,
      created_at: msg.createdAt || Date.now(),
    }));

    return { ...conv, messages };
  }

  async count(userId: string): Promise<number> {
    const threads = await this.store.listThreads({ userId });
    return threads.length;
  }

  async recent(userId: string, limit = 5): Promise<RecentConversation[]> {
    const threads = (await this.store.listThreads({ userId })).slice(0, limit);

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
        const entries = await this.store.getEntries(thread.id);
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

  async delete(userId: string, id: string): Promise<boolean> {
    const thread = await this.store.getThread(id);
    if (!thread) return false;

    try {
      const db = getDb();
      await (db as any).run('DELETE FROM vico_messages WHERE thread_id = ?', [id]);
      await (db as any).run('DELETE FROM vico_turns WHERE thread_id = ?', [id]);
      await (db as any).run('DELETE FROM vico_threads WHERE id = ?', [id]);
      return true;
    } catch {
      return false;
    }
  }
}

export const conversationManager = new ConversationManager();
