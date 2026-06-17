/**
 * Assistant UI Runtime hook — 封装 useChatRuntime 连接 AI SDK 端点。
 *
 * 使用 @assistant-ui/react-ai-sdk 的 useChatRuntime 创建 AssistantRuntime，
 * 通过 ai 的 DefaultChatTransport 连接 /api/v1/chat 端点。
 * 支持历史消息加载和 threadId 回写。
 */
import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useChatRuntime} from '@assistant-ui/react-ai-sdk';
import {DefaultChatTransport} from 'ai';
import {api} from '@/api/client';

export interface UseAssistantRuntimeOptions {
  /** Agent ID，会作为 body 参数发送到服务端 */
  agentId: string;
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
  agent_id: string;
}

/**
 * 创建 Assistant UI 聊天运行时。
 *
 * 当 agentId 或 threadId 变化时会自动重建 runtime。
 * 有 threadId 时自动加载历史消息作为 initialMessages。
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
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/chat',
        credentials: 'include',
        body: () => ({ agentId, threadId }),
      }),
    [agentId, threadId],
  );

  // 加载历史消息
  const { data: history } = useQuery<ConversationData>({
    queryKey: ['conversation', threadId],
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
      // 从 finish 事件的 messageMetadata 中提取 threadId
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
