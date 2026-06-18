/**
 * Team Assistant UI Runtime hook — 封装 useChatRuntime 连接团队聊天端点。
 *
 * 使用 @assistant-ui/react-ai-sdk 的 useChatRuntime 创建 AssistantRuntime，
 * 通过 ai 的 DefaultChatTransport 连接 /api/v1/teams/:id/chat 端点。
 */
import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useChatRuntime} from '@assistant-ui/react-ai-sdk';
import {DefaultChatTransport} from 'ai';
import {api} from '@/api/client';

export interface UseTeamAssistantRuntimeOptions {
  /** Team ID，端点路径为 /api/v1/teams/:teamId/chat */
  teamId: string;
  /** 可选的 thread ID，用于加载历史消息和继续对话 */
  threadId?: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ConversationData {
  messages: MessageItem[];
}

/**
 * 创建团队聊天 Assistant UI 运行时。
 *
 * 当 teamId 或 threadId 变化时会自动重建 runtime。
 * 有 threadId 时自动加载历史消息作为 initialMessages。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例，可直接传给 AssistantRuntimeProvider
 */
export function useTeamAssistantRuntime({
  teamId,
  threadId,
  onThreadCreated,
  onError,
}: UseTeamAssistantRuntimeOptions) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/v1/teams/${teamId}/chat`,
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages, body, id }) => {
          // 只发送最后一条 user message，历史由 Mastra memory 管理
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
          return {
            body: {
              ...body,
              id,
              messages: lastUserMsg ? [lastUserMsg] : [],
            },
          };
        },
      }),
    [teamId],
  );

  // 加载历史消息
  const { data: history } = useQuery<ConversationData>({
    queryKey: ['team-conversation', threadId],
    queryFn: () => api(`/conversations/${threadId}`),
    enabled: !!threadId,
  });

  // 将后端历史消息转为 AI SDK UIMessage 格式（parts 数组）
  const initialMessages = useMemo(
    () =>
      (history?.messages || []).map((msg) => ({
        id: msg.id || crypto.randomUUID(),
        role: msg.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: msg.content }],
      })),
    [history],
  );

  return useChatRuntime({
    transport,
    id: threadId,
    messages: initialMessages,
    onFinish: ({message}) => {
      const meta = (message as any)?.metadata;
      if (!threadId && meta?.threadId && typeof meta.threadId === 'string') {
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
}
