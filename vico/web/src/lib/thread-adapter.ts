/**
 * 线程适配器 — 将 assistant-ui 的 ThreadList 和 ThreadHistory 连接到后端 /api/v1/threads。
 *
 * - createThreadListAdapter: 线程列表适配器（list、delete、initialize）
 * - createThreadHistoryAdapter: 历史消息适配器，通过 useAgUiRuntime 的 adapters.history 自动加载
 */
import type {
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  ThreadMessage,
} from '@assistant-ui/react';
import {ExportedMessageRepository} from '@assistant-ui/react';
import {fromAgUiMessages} from '@assistant-ui/react-ag-ui';
import type {Message as AgUiMessage} from '@ag-ui/client';
import {api} from '@/api/client';
import {queryClient} from '@/lib/query-client';
import {useAgentSelection} from '@/stores/agent-selection';

/**
 * 创建适配器，连接后端线程列表。
 *
 * @param agentId - 固定 Agent ID（Agent 详情页测试对话区传入）；Chat 路由不传，
 *                  此时线程列表不按 Agent 过滤，预创建线程的 Agent 取 composer 选中态。
 * @param enabled - 是否启用列表请求（非 Chat 路由关闭，避免全量线程查询）
 */
export function createThreadListAdapter(agentId?: string, enabled = true): RemoteThreadListAdapter {
  return {
    async list() {
      // 非启用态（如非 Chat 路由）不发起请求
      if (!enabled) return { threads: [] };
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const query = params.toString();
      const data = await api<ThreadItem[]>(`/threads${query ? `?${query}` : ''}`);
      const threads = Array.isArray(data) ? data : [];
      return {
        threads: threads.map((t) => ({
          status: t.archived ? ('archived' as const) : ('regular' as const),
          remoteId: t.id,
          title: t.title || 'New Chat',
          lastMessageAt: new Date(t.updatedAt),
        })),
      };
    },

    async fetch(threadId: string) {
      const item = await api<ThreadItem>(`/threads/${threadId}`);
      return {
        status: item.archived ? ('archived' as const) : ('regular' as const),
        remoteId: item.id,
        title: item.title || 'New Chat',
        lastMessageAt: new Date(item.updatedAt),
      };
    },

    /**
     * 新线程初始化 — 首次发送消息前由 assistant-ui 调用（发送前会 await 本方法），
     * 这里先请求后端创建会话拿到真实 thread id，再作为 remoteId 返回。
     */
    async initialize(_threadId: string) {
      const id = agentId ?? useAgentSelection.getState().selectedAgent?.id;
      if (!id) throw new Error('No agent selected');
      const thread = await api<{ id: string }>('/threads', {
        method: 'POST',
        body: JSON.stringify({ agentId: id }),
      });
      return { remoteId: thread.id, externalId: undefined };
    },

    async delete(remoteId: string) {
      await api(`/threads/${remoteId}`, { method: 'DELETE' });
    },

    async rename(remoteId: string, newTitle: string) {
      await api(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle }),
      });
      queryClient.invalidateQueries({ queryKey: ['thread', remoteId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },

    async archive(remoteId: string) {
      await api(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      queryClient.invalidateQueries({ queryKey: ['thread', remoteId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },

    async unarchive(remoteId: string) {
      await api(`/threads/${remoteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: false }),
      });
      queryClient.invalidateQueries({ queryKey: ['thread', remoteId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
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

interface ThreadItem {
  id: string;
  title: string;
  /** 是否已归档（对应 assistant-ui 的 archived status） */
  archived: boolean;
  updatedAt: number;
}

interface ThreadDetail {
  messages: AgUiMessage[];
}

/**
 * 创建历史消息适配器，供 useAgUiRuntime 的 adapters.history 使用。
 *
 * 后端 /api/v1/threads/:id 返回 ag-ui Message[]，经 fromAgUiMessages 还原为
 * assistant-ui 消息树（含 reasoning / tool call 的折叠）。
 *
 * @param remoteId - 线程真实 ID，为本地 ID（__LOCALID_ 前缀）时跳过加载
 */
export function createThreadHistoryAdapter(remoteId: string | undefined): ThreadHistoryAdapter {
  return {
    async load() {
      if (!remoteId || remoteId.startsWith('__LOCALID_')) {
        return ExportedMessageRepository.fromArray([]);
      }
      const data = await api<ThreadDetail>(`/threads/${remoteId}`);
      const msgs = data.messages || [];
      return ExportedMessageRepository.fromArray(fromAgUiMessages(msgs));
    },

    async append() {
      // 后端通过 SSE 流已持久化消息，无需客户端重复保存
    },
  };
}
