import {vico} from '../../vico.js';
import {agentManager} from '../agent/agent-manager.js';
import type {RecentThread, ThreadDetail, ThreadItem} from './types.js';
import {type ContentPart, type Message, type ThreadStore, toUiMessages} from "@vico/core";

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

  async list(
    userId: string,
    filters?: { search?: string; agent_id?: string },
  ): Promise<ThreadItem[]> {
    const search = filters?.search?.toLowerCase();
    const agentIdFilter = filters?.agent_id;
    const threads = await this.store.listThreads({ userId, agentId: agentIdFilter || undefined });

    let items: ThreadItem[] = [];
    for (const thread of threads) {
      let messageCount = 0;
      try {
        const entries = await this.store.getEntries(thread.id, { roles: VISIBLE_ROLES });
        messageCount = entries.length;
      } catch { /* 消息计数失败不影响列表返回 */ }
      items.push({ ...thread, messageCount });
    }

    if (search) {
      items = items.filter((t) => t.title?.toLowerCase().includes(search));
    }

    items.sort((a, b) => b.updatedAt - a.updatedAt);
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

    const entries = await this.store.getEntries(id, { ...pagination, roles: VISIBLE_ROLES });
    // messageCount 需要总数，分页时单独查询
    let messageCount = entries.length;
    if (pagination?.limit != null) {
      const all = await this.store.getEntries(id, { roles: VISIBLE_ROLES });
      messageCount = all.length;
    }

    const messages = toUiMessages(entries);
    return { ...thread, messageCount, messages};
  }

  async count(userId: string): Promise<number> {
    const threads = await this.store.listThreads({ userId });
    return threads.length;
  }

  async recent(userId: string, limit = 5): Promise<RecentThread[]> {
    const threads = (await this.store.listThreads({ userId })).slice(0, limit);

    const items: RecentThread[] = [];
    for (const thread of threads) {
      const agentName = thread.agentId
        ? await agentManager.getName(thread.agentId)
        : undefined;

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
        agentName,
        messageCount,
        lastMessage,
        updatedAt: thread.updatedAt || Date.now(),
      });
    }

    return items;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const thread = await this.store.getThread(id);
    if (!thread) return false;
    if (thread.userId && thread.userId !== userId) return false;

    try {
      await this.store.deleteThread(id);
      return true;
    } catch {
      return false;
    }
  }
}

export const threadManager = new ThreadManager();
