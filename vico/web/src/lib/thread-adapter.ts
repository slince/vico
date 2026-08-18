/**
 * 线程适配器 — 将 assistant-ui 的 ThreadList 和 ThreadHistory 连接到后端 /api/v1/threads。
 *
 * - createThreadListAdapter: 线程列表适配器（list、delete、initialize）
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

interface ToolResultEntry {
  toolCallId: string;
  output: unknown;
  isError?: boolean;
}

/** 从消息组中提取 tool-result 映射（toolCallId → 结果详情） */
function extractToolResultMap(messages: MessageItem[]): Map<string, ToolResultEntry> {
  const map = new Map<string, ToolResultEntry>();
  for (const msg of messages) {
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as Array<Record<string, unknown>>) {
      if (part.type === 'tool-result' && typeof part.toolCallId === 'string') {
        map.set(part.toolCallId, {
          toolCallId: part.toolCallId,
          output: part.output,
          isError: (part as any).isError ?? false,
        });
      }
    }
  }
  return map;
}

/**
 * 处理消息列表：合并 tool-result 到对应 assistant 消息的 tool-call part，并注入审批状态。
 * 返回助理 UI 可直接渲染的消息数组（仅 user/assistant 角色，工具消息已吸收）。
 */
function processHistoryMessages(
  messages: MessageItem[],
  paused?: boolean,
  pendingToolCalls?: Array<{ id: string; name: string; args: unknown }>,
): Array<{ parentIndex: number; message: { id: string; role: 'user' | 'assistant'; parts: ContentPart[] } }> {
  const toolResultMap = extractToolResultMap(messages);
  const pendingIds = new Set(pendingToolCalls?.map(tc => tc.id) ?? []);

  // 过滤掉 tool 消息，保留 user/assistant/system
  const visible = messages.filter(m => m.role !== 'tool');

  return visible.map((msg, i) => {
    let parts = normalizeContentParts(msg.content);

    if (msg.role === 'assistant') {
      parts = parts.map((part): ContentPart => {
        if (part.type !== 'tool-call') return part;
        const tc = part as Record<string, unknown>;
        const result = toolResultMap.get(tc.toolCallId as string);
        const needsApproval = paused && pendingIds.has(tc.toolCallId as string);

        const enriched: Record<string, unknown> = { ...tc };
        if (result) {
          enriched.result = {
            type: 'tool-result',
            toolCallId: result.toolCallId,
            toolName: tc.toolName,
            output: result.output,
            isError: result.isError,
          };
        }
        if (needsApproval) {
          enriched.approval = { approvalId: tc.toolCallId };
        }
        return enriched as ContentPart;
      });
    }

    return {
      parentIndex: i > 0 ? i - 1 : -1,
      message: {
        id: msg.id || crypto.randomUUID(),
        role: (msg.role === 'system' ? 'assistant' : msg.role) as 'user' | 'assistant',
        parts,
      },
    };
  });
}

interface ThreadItem {
  id: string;
  title: string;
  updated_at: number;
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
          lastMessageAt: new Date(t.updated_at),
        })),
      };
    },

    async fetch(threadId: string) {
      const item = await api<ThreadItem>(`/threads/${threadId}`);
      return {
        status: 'regular' as const,
        remoteId: item.id,
        title: item.title || 'New Chat',
        lastMessageAt: new Date(item.updated_at),
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

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
}

interface ThreadDetail {
  messages: MessageItem[];
  paused?: boolean;
  pendingToolCalls?: Array<{ id: string; name: string; args: unknown }>;
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

          const processed = processHistoryMessages(msgs, data.paused, data.pendingToolCalls);
          return {
            messages: processed.map(({ message, parentIndex }) => ({
              parentId: parentIndex >= 0 ? processed[parentIndex]!.message.id : null,
              message,
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
