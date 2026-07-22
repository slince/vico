/**
 * 对话适配器 — 将 assistant-ui 的 ThreadList 和 ThreadHistory 连接到后端 /api/v1/conversations。
 *
 * - createConversationThreadAdapter: 对话列表适配器（list、delete、initialize）
 * - createThreadHistoryAdapter: 历史消息适配器，通过 useChatRuntime 的 adapters.history 自动加载/持久化
 */
import type {
  GenericThreadHistoryAdapter,
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  ThreadMessage
} from '@assistant-ui/react';
import type {ContentPart} from '@vico/core';
import {api} from '@/api/client';

/**
 * 将 API 返回的 content 归一化为 assistant-ui 的 parts 数组。
 *
 * - 新格式（原生 parts 数组）→ 直接使用，保留 reasoning / text 等全量 parts
 * - 旧格式（纯文本字符串）→ 包裹为单 text part
 */
function normalizeContentParts(content: string | ContentPart[]): ContentPart[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [{ type: 'text', text: String(content ?? '') }];
}

interface ConversationItem {
  id: string;
  title: string;
  updated_at: number;
}

/**
 * 创建适配器，连接后端对话列表。
 *
 * @param agentId - 当前选中的 Agent ID，用于过滤对话列表
 */
export function createConversationThreadAdapter(agentId: string): RemoteThreadListAdapter {
  return {
    async list() {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const data = await api<ConversationItem[]>(`/conversations?${params.toString()}`);
      const conversations = Array.isArray(data) ? data : [];
      return {
        threads: conversations.map((c) => ({
          status: 'regular' as const,
          remoteId: c.id,
          title: c.title || 'New Chat',
          lastMessageAt: new Date(c.updated_at),
        })),
      };
    },

    async fetch(threadId: string) {
      const c = await api<ConversationItem>(`/conversations/${threadId}`);
      return {
        status: 'regular' as const,
        remoteId: c.id,
        title: c.title || 'New Chat',
        lastMessageAt: new Date(c.updated_at),
      };
    },

    /**
     * 新线程初始化 — 对话在 Mastra 首次消息发送时才创建，
     * 因此直接使用本地 ID 作为 remoteId，后续 onFinish 再回写真实 ID。
     */
    async initialize(threadId: string) {
      return { remoteId: threadId, externalId: undefined };
    },

    async delete(remoteId: string) {
      await api(`/conversations/${remoteId}`, { method: 'DELETE' });
    },

    async rename(_remoteId: string, _newTitle: string) {
      // 后端暂不支持重命名
    },

    async archive(_remoteId: string) {
      // 后端暂不支持归档
    },

    async unarchive(_remoteId: string) {
      // 后端暂不支持取消归档
    },

    async generateTitle(
      _remoteId: string,
      _unstable_messages: readonly ThreadMessage[],
    ) {
      // 返回空流，标题由后端管理
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    },
  };
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

interface ConversationDetail {
  messages: MessageItem[];
}

/**
 * 创建历史消息适配器，供 useChatRuntime 的 adapters.history 使用。
 *
 * useExternalHistory 通过 withFormat 获取 GenericThreadHistoryAdapter，
 * 自动负责加载历史和持久化新消息。
 *
 * @param remoteId - 对话 ID，为本地 ID（__LOCALID_ 前缀）时跳过加载
 */
export function createThreadHistoryAdapter(remoteId: string | undefined): ThreadHistoryAdapter {
  return {
    // useExternalHistory 调用 withFormat 获取格式化适配器
    withFormat() {
      return {
        async load() {
          if (!remoteId || remoteId.startsWith('__LOCALID_')) return { messages: [] };

          const data = await api<ConversationDetail>(`/conversations/${remoteId}`);
          const msgs = data.messages || [];
          return {
            messages: msgs.map((msg, i) => ({
              // 建立父子链：每条消息的 parentId 指向前一条，首条为 null
              parentId: (i > 0 ? msgs[i - 1]!.id : null) as string | null,
              message: {
                id: msg.id || crypto.randomUUID(),
                role: msg.role as 'user' | 'assistant',
                parts: normalizeContentParts(msg.content),
              },
            })),
          };
        },

        async append() {
          // 后端通过 SSE 流已持久化消息，无需客户端重复保存
        },

        async delete() {},
      } as GenericThreadHistoryAdapter<any>;
    },

    // ThreadHistoryAdapter 类型要求的 direct 方法（实际调用走 withFormat 路径）
    async load() {
      return { messages: [] };
    },

    async append() {},
  };
}
