/**
 * 线程适配器 — 将 assistant-ui 的 ThreadList 和 ThreadHistory 连接到后端 /api/v1/threads。
 *
 * - createThreadListAdapter: 线程列表适配器（list、delete、initialize）
 * - createThreadHistoryAdapter: 历史消息适配器，通过 useChatRuntime 的 adapters.history 自动加载/持久化
 */
import type {
  GenericThreadHistoryAdapter,
  MessageFormatItem,
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  ThreadMessage
} from '@assistant-ui/react';
import type {ContentPart} from '@vico/core';
import {api} from '@/api/client';
import {UIMessage} from "ai";

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

/**
 * 将后端返回的扁平 UIMessage 列表转换为 assistant-ui 历史消息格式。
 *
 * 后端已通过 toUiMessages 完成 tool 消息合并与 tool part 状态注入，此处仅需
 * 为每条消息建立 parentId 链：线性历史中即上一条消息的 id，首条为 null。
 *
 * @param messages - 后端返回的扁平消息列表（已按时间排序）
 * @returns 带 parentId 指向的消息项数组，供 assistant-ui 重建消息树
 */
function processHistoryMessages(messages: UIMessage[]): MessageFormatItem<UIMessage>[] {
  return messages.map((message, index) => ({
    parentId: index > 0 ? messages[index - 1]!.id : null,
    message,
  }));
}

interface ThreadItem {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * 创建适配器，连接后端线程列表。
 *
 * @param agentId - 当前选中的 Agent ID，用于过滤线程列表
 */
export function createThreadListAdapter(agentId: string): RemoteThreadListAdapter {
  return {
    async list() {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const data = await api<ThreadItem[]>(`/threads?${params.toString()}`);
      const threads = Array.isArray(data) ? data : [];
      return {
        threads: threads.map((t) => ({
          status: 'regular' as const,
          remoteId: t.id,
          title: t.title || 'New Chat',
          lastMessageAt: new Date(t.updatedAt),
        })),
      };
    },

    async fetch(threadId: string) {
      const item = await api<ThreadItem>(`/threads/${threadId}`);
      return {
        status: 'regular' as const,
        remoteId: item.id,
        title: item.title || 'New Chat',
        lastMessageAt: new Date(item.updatedAt),
      };
    },

    /**
     * 新线程初始化 — 线程在 Mastra 首次消息发送时才创建，
     * 因此直接使用本地 ID 作为 remoteId，后续 onFinish 再回写真实 ID。
     */
    async initialize(threadId: string) {
      return { remoteId: threadId, externalId: undefined };
    },

    async delete(remoteId: string) {
      await api(`/threads/${remoteId}`, { method: 'DELETE' });
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

interface ThreadDetail {
  messages: UIMessage[];
}

/**
 * 创建历史消息适配器，供 useChatRuntime 的 adapters.history 使用。
 *
 * useExternalHistory 通过 withFormat 获取 GenericThreadHistoryAdapter，
 * 自动负责加载历史和持久化新消息。
 *
 * @param remoteId - 线程 ID，为本地 ID（__LOCALID_ 前缀）时跳过加载
 */
export function createThreadHistoryAdapter(remoteId: string | undefined): ThreadHistoryAdapter {
  return {
    // useExternalHistory 调用 withFormat 获取格式化适配器
    withFormat() {
      return {
        async load() {
          if (!remoteId || remoteId.startsWith('__LOCALID_')) return { messages: [] };

          const data = await api<ThreadDetail>(`/threads/${remoteId}`);
          const msgs = data.messages || [];

          return {
            messages: processHistoryMessages(msgs),
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
