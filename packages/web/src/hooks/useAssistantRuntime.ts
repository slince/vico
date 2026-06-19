/**
 * Assistant UI Runtime hook — 使用 useRemoteThreadListRuntime 连接后端对话列表。
 *
 * 与 Chat.tsx 中 AssistantRuntimeProvider 配合使用：
 * - 通过 RemoteThreadListAdapter 从 /api/v1/conversations 加载对话列表
 * - 每个线程通过 runtimeHook 创建独立的 useChatRuntime 实例
 * - 支持历史消息加载和 threadId 回写
 */
import {useCallback, useMemo} from 'react';
import {useChatRuntime} from '@assistant-ui/react-ai-sdk';
import {useRemoteThreadListRuntime, useThreadListItem} from '@assistant-ui/react';
import {DefaultChatTransport} from 'ai';
import {createConversationThreadAdapter, createThreadHistoryAdapter} from '@/lib/conversation-thread-adapter';

export interface UseAssistantRuntimeOptions {
  /** Agent ID，同时用于对话列表过滤和发送消息 */
  agentId: string;
  /** 可选的 thread ID，用于加载历史消息和继续对话 */
  threadId?: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 创建 Assistant UI 聊天运行时，集成远程对话列表。
 *
 * 线程列表通过 RemoteThreadListAdapter 从后端加载，
 * 每个线程独立创建 useChatRuntime 实例处理消息。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例，可直接传给 AssistantRuntimeProvider
 */
export function useAssistantRuntime({
  agentId,
  threadId,
  onThreadCreated,
  onError,
}: UseAssistantRuntimeOptions) {
  // 对话列表适配器 — 按 agentId 过滤
  const adapter = useMemo(
    () => createConversationThreadAdapter(agentId),
    [agentId],
  );

  /**
   * 线程运行时工厂 — useRemoteThreadListRuntime 为每个活跃线程调用此函数。
   * 在 ThreadListItemRuntimeProvider 上下文中执行，可使用 useThreadListItem 获取线程元数据。
   */
  const runtimeHook = useCallback(() => {
    // useThreadListItem() 返回 ThreadListItemState，remoteId 为直接属性
    const { remoteId } = useThreadListItem();

    // 历史消息适配器 — 使用 useChatRuntime 的 adapters.history 自动加载
    const history = useMemo(
      () => createThreadHistoryAdapter(remoteId),
      [remoteId],
    );

    // 为此线程创建 transport — remoteId 为 Mastra 对话 ID（新线程则为本地 ID）
    const transport = useMemo(
      () =>
        new DefaultChatTransport({
          api: '/api/v1/chat',
          credentials: 'include',
          body: () => ({ agentId, threadId: remoteId }),
          prepareSendMessagesRequest: ({ messages, body, id }) => {
            const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
            return {
              body: {
                ...body,
                id: remoteId,
                messages: lastUserMsg ? [lastUserMsg] : [],
              },
            };
          },
        }),
      [agentId, remoteId],
    );

    return useChatRuntime({
      transport,
      id: remoteId,
      adapters: { history },
      onFinish: ({message}) => {
        const meta = (message as any)?.metadata;
        // 新线程首次发送后，后端返回真实 Mastra threadId
        if (meta?.threadId && typeof meta.threadId === 'string' && meta.threadId !== remoteId) {
          onThreadCreated?.(meta.threadId);
        }
      },
      onError: (err: Error) => {
        if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
          window.location.href = '/login';
        }
        onError?.(err);
      },
    });
  }, [agentId, onThreadCreated, onError]);

  return useRemoteThreadListRuntime({
    runtimeHook,
    adapter,
    threadId,
  });
}
