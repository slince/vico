import {eq} from 'drizzle-orm';
import {getDb, schema} from '../../db/db.js';
import {vico} from '../../vico.js';
import type {ThreadDetail, ThreadItem, MessageItem, RecentThread} from './types.js';
import {type ContentPart, type Message, type ThreadStore} from "@vico/core";

const { agents } = schema;

/**
 * 解析消息 content 为原生 parts 数组，解析失败时按纯文本兜底。
 */
function parseMessageContent(msg: Message): string | ContentPart[] {
  try {
    return JSON.parse(msg.content) as ContentPart[];
  } catch {
    return msg.content;
  }
}

/** 前台展示的消息角色 */
const VISIBLE_ROLES = ['user', 'assistant', 'system', 'tool'];

class ThreadManager {
  /** Vico 容器的共享 ThreadStore */
  private get store(): ThreadStore {
    return vico.thread!;
  }

  private toThreadItem(thread: any): ThreadItem {
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
  ): Promise<ThreadItem[]> {
    const search = filters?.search?.toLowerCase();
    const agentIdFilter = filters?.agent_id;
    const threads = await this.store.listThreads({ userId, agentId: agentIdFilter || undefined });

    let items: ThreadItem[] = [];
    for (const thread of threads) {
      const item = this.toThreadItem(thread);

      try {
        const entries = await this.store.getEntries(thread.id, { roles: VISIBLE_ROLES });
        item.message_count = entries.length;
      } catch {
        item.message_count = 0;
      }
      items.push(item);
    }

    if (search) {
      items = items.filter((t) => t.title.toLowerCase().includes(search));
    }

    items.sort((a, b) => b.updated_at - a.updated_at);
    return items;
  }

  async getById(
    userId: string,
    id: string,
    pagination?: { limit?: number; start?: number },
  ): Promise<ThreadDetail | null> {
    const thread = await this.store.getThread(id);
    if (!thread) return null;
    if (thread.userId && thread.userId !== userId) return null;

    const item = this.toThreadItem(thread);

    const entries = await this.store.getEntries(id, { ...pagination, roles: VISIBLE_ROLES });
    // message_count 需要总数，分页时单独查询
    if (pagination?.limit != null) {
      const all = await this.store.getEntries(id, { roles: VISIBLE_ROLES });
      item.message_count = all.length;
    } else {
      item.message_count = entries.length;
    }

    const messages: MessageItem[] = entries.map((msg: Message) => ({
      id: msg.id,
      thread_id: msg.threadId ?? id,
      role: msg.role,
      content: parseMessageContent(msg),
      token_usage: 0,
      created_at: msg.createdAt ?? Date.now(),
    }));

    // 检查暂停状态
    let paused = false;
    let pendingToolCalls: Array<{ id: string; name: string; args: unknown }> | undefined;
    try {
      const latestTurn = await this.store.getLatestTurn(id);
      if (latestTurn && latestTurn.status === 'paused') {
        const checkpoint = await vico.checkpointStore?.getByTurn(latestTurn.id);
        if (checkpoint?.pauseInfo?.pendingToolCalls) {
          paused = true;
          pendingToolCalls = checkpoint.pauseInfo.pendingToolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
          }));
        }
      }
    } catch { /* 获取暂停状态失败不影响消息返回 */ }

    return { ...item, messages, paused, pendingToolCalls };
  }

  async count(userId: string): Promise<number> {
    const threads = await this.store.listThreads({ userId });
    return threads.length;
  }

  async recent(userId: string, limit = 5): Promise<RecentThread[]> {
    const threads = (await this.store.listThreads({ userId })).slice(0, limit);

    const items: RecentThread[] = [];
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
        const entries = await this.store.getEntries(thread.id, { roles: VISIBLE_ROLES });
        messageCount = entries.length;
        if (entries.length > 0) {
          const last = entries[entries.length - 1];
          const lastContent = parseMessageContent(last);
          if (typeof lastContent === 'string') {
            lastMessage = lastContent || undefined;
          } else if (Array.isArray(lastContent)) {
            // 从原生 parts 中提取纯文本用于预览
            lastMessage = (lastContent as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text' || p.type === 'reasoning')
              .map((p) => p.text ?? '')
              .join(' ') || undefined;
          }
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
    if (thread.userId && thread.userId !== userId) return false;

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

export const threadManager = new ThreadManager();
