/**
 * 对话线程运行时 hook — 为单个线程创建 useChatRuntime 实例。
 *
 * 封装 transport 创建、历史适配器注入、onFinish threadId 回写和错误处理，
 * useAssistantRuntime 的 runtimeHook 和 useTeamAssistantRuntime 共用此 hook。
 */
import {useMemo, useRef} from 'react';
import {useChatRuntime} from '@assistant-ui/react-ai-sdk';
import {DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses} from 'ai';

import {createThreadHistoryAdapter} from '@/lib/thread-adapter';
import {useAuiState} from "@assistant-ui/react";

export interface UseChatThreadRuntimeOptions {
  /** Agent ID */
  agentId: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 为指定线程创建 AssistantRuntime。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例
 */
export function useChatThreadRuntime({agentId, onThreadCreated, onError,}: UseChatThreadRuntimeOptions) {

  const threadId = useAuiState(state => state.threadListItem.id);

  // 历史消息适配器 — 使用 useChatRuntime 的 adapters.history 自动加载
  const history = useMemo(
    () => createThreadHistoryAdapter(threadId),
    [threadId],
  );

  // 用 ref 持有 onThreadCreated，避免 fetch 闭包捕获旧引用
  const onThreadCreatedRef = useRef(onThreadCreated);
  onThreadCreatedRef.current = onThreadCreated;

  // 从响应头提取的 threadId，待 onFinish 消费
  const newThreadIdRef = useRef<string | null>(null);

  // 为此线程创建 transport — threadId 为对话 ID（新线程则为本地 ID）
  const transport = useMemo(() => new DefaultChatTransport({
        api: '/api/v1/chat',
        credentials: 'include',
        body: () => ({ agentId }),
        prepareSendMessagesRequest: ({ messages, body, id }) => {
          const lastMsg = messages[messages.length - 1];

          return {
            body: {
              ...body,
              threadId,
              messages: lastMsg ? [lastMsg] : [],
            },
          };
        },
        // 拦截响应头，记录服务端返回的真实 threadId，待流结束后在 onFinish 中使用
        fetch: async (url, init) => {
          const response = await fetch(url, init);
          const newId = response.headers.get('x-thread-id');
          if (newId && newId !== threadId) {
            newThreadIdRef.current = newId;
          }
          return response;
        },
      }),
    [agentId, threadId],
  );

  return useChatRuntime({
    transport,
    id: threadId,
    adapters: { history },
    // 当所有审批决议就绪时自动发送（无需用户手动输入消息）
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      const newThreadId = newThreadIdRef.current;
      if (newThreadId && newThreadId !== threadId) {
        onThreadCreatedRef.current?.(newThreadId);
        newThreadIdRef.current = null;
      }
    },
    onError: (err: Error) => {
      if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        console.warn('[chat] 流式请求收到 401/Unauthorized，会话可能失效，暂不跳转登录页', { message: err.message });
      }
      onError?.(err);
    },
  });
}
