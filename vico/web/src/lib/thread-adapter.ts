/**
 * 线程适配器 — 将 assistant-ui 的 ThreadList 和 ThreadHistory 连接到后端 /api/v1/threads。
 *
 * - createThreadListAdapter: 线程列表适配器（list、delete、initialize）
 * - createThreadHistoryAdapter: 历史消息适配器，通过 useAgUiRuntime 的 adapters.history 自动加载
 */
import type {RemoteThreadListAdapter, ThreadHistoryAdapter, ThreadMessage,} from '@assistant-ui/react';
import {ExportedMessageRepository} from '@assistant-ui/react';
import {fromAgUiMessages} from '@assistant-ui/react-ag-ui';
import type {Message as AgUiMessage} from '@ag-ui/client';
import {createAssistantStream} from 'assistant-stream';
import {api} from '@/api/client';
import {queryClient} from '@/lib/query-client';
import {useAgentSelection} from '@/stores/agent-selection';
import {useWorkspaceSelection} from '@/stores/workspace-selection';

/**
 * 同一草稿的 initialize 任务缓存。
 *
 * assistant-ui 自身（RemoteThreadResource 的 initialize 事件）只会在首条消息发送前调用一次，
 * 但列表/受控切换等路径也可能再次调用，缓存保证同一个草稿只向 /threads 发一次 POST。
 */
const initializeTasks = new Map<string, Promise<{remoteId: string; externalId?: string}>>();

/**
 * 草稿本地 ID → initialize 返回的后端 ID。
 *
 * assistant-ui 的线程列表状态要等 React 提交后才刷新，紧随 initialize 的首条消息请求读不到
 * `remoteId`；而草稿一激活 assistant-ui 就会触发 initialize（发送前不一定等到它完成），
 * 所以这里把结果同步记下来：请求发出时先读这里，读不到再由 `VicoHttpAgent` await 同一任务的缓存。
 */
const initializedThreadIds = new Map<string, string>();

/**
 * 读取某个草稿 initialize 创建出的后端 thread ID。
 *
 * @param localId - 草稿的本地 ID（`__LOCALID_` 前缀）
 * @returns 后端 ID；该草稿尚未 initialize 或创建失败时为 undefined
 */
export function getInitializedThreadId(localId: string): string | undefined {
  return initializedThreadIds.get(localId);
}

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
          custom: t.metadata,
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
        custom: item.metadata,
      };
    },

    /**
     * 新线程初始化 — 首次发送消息前由 assistant-ui 调用（发送前会 await 本方法），
     * 这里先请求后端创建会话拿到真实 thread id，再作为 remoteId 返回。
     *
     * 同时透传 draft custom 里的 workspace（WorkspaceSelectorAction 写入），
     * 后端据此在创建 thread 时一并写入 metadata.workspace，
     * 使新会话无需刷新即可归入正确工作区分组。
     */
    async initialize(
      threadId: string,
      options?: { custom?: Record<string, unknown> },
    ) {
      // 同一个草稿只创建一次：assistant-ui 内部的 initialize 与其它路径可能同时到达这里
      const pending = initializeTasks.get(threadId);
      if (pending) return pending;

      const task = (async () => {
        const id = agentId ?? useAgentSelection.getState().selectedAgent?.id;
        if (!id) throw new Error('No agent selected');

        const workspace =
          (options?.custom?.workspace as string | undefined) ??
          useWorkspaceSelection.getState().workspace ??
          undefined;

        const body: { agentId: string; workspace?: string } = { agentId: id };
        if (workspace) body.workspace = workspace;

        const thread = await api<{ id: string }>('/threads', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        // 请求发出时同步读取（详见 getInitializedThreadId）
        initializedThreadIds.set(threadId, thread.id);
        return { remoteId: thread.id, externalId: undefined };
      })();

      initializeTasks.set(threadId, task);
      task.catch(() => {
        if (initializeTasks.get(threadId) === task) initializeTasks.delete(threadId);
      });
      return task;
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

    /**
     * 草稿自定义元数据（目前只有 workspace）。
     *
     * assistant-ui 在草稿被乐观 promote（initialize 已发起、remoteId 尚未回填）时会要求 adapter
     * 提供本方法，否则 updateCustom 直接抛错，草稿的 custom 写不进去 —— 表现为新会话首次
     * 出现在「未分组」，刷新后（改由 list() 读后端 metadata）才归位。
     *
     * 这里只做本地占位：assistant-ui 会把 custom 写进列表项（乐观更新已生效），
     * 后端则由首条消息的 config.workspace 在 resolveThread 时回写 thread.metadata。
     */
    async updateCustom(_remoteId: string, _custom?: Record<string, unknown>) {
      // no-op：本地列表项已由 assistant-ui 更新，后端在首条消息时落库
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
      remoteId: string,
      _unstable_messages: readonly ThreadMessage[],
    ) {
      // 后端在首条消息时生成标题；这里读回并把标题追加进流，
      // 使新会话标题无需整体刷新即可更新
      return createAssistantStream(async (controller) => {
        try {
          const item = await api<ThreadItem>(`/threads/${remoteId}`);
          if (item.title) controller.appendText(item.title);
        } catch (e) {
          // 读回失败静默，标题保持 fallback，下次 list 仍会取到后端标题
          console.error("generateTitle:", e)
        }
      });
    },
  };
}

interface ThreadItem {
  id: string;
  title: string;
  /** 是否已归档（对应 assistant-ui 的 archived status） */
  archived: boolean;
  /** 自定义元数据，透传给 assistant-ui 的 RemoteThreadMetadata.custom */
  metadata?: Record<string, unknown>;
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

      const messages = fromAgUiMessages(msgs);
      console.log("thread adapter:", messages);
      return ExportedMessageRepository.fromArray(messages);
    },

    async append() {
      // 后端通过 SSE 流已持久化消息，无需客户端重复保存
    },
  };
}
