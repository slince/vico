/**
 * 对话线程运行时 hook — 为单个线程创建 useChatRuntime 实例。
 *
 * 封装 transport 创建、历史适配器注入、onFinish threadId 回写和错误处理，
 * useAssistantRuntime 的 runtimeHook 和 useTeamAssistantRuntime 共用此 hook。
 */
import {useMemo} from 'react';
import {useChatRuntime} from '@assistant-ui/react-ai-sdk';
import {DefaultChatTransport} from 'ai';
import {createThreadHistoryAdapter} from '@/lib/conversation-thread-adapter';
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

  const remoteId = useAuiState(state => state.threadListItem.id);

  // 历史消息适配器 — 使用 useChatRuntime 的 adapters.history 自动加载
  const history = useMemo(
    () => createThreadHistoryAdapter(remoteId),
    [remoteId],
  );

  // 为此线程创建 transport — remoteId 为对话 ID（新线程则为本地 ID）
  const transport = useMemo(
    () => new DefaultChatTransport({
        api: '/api/v1/chat',
        credentials: 'include',
        body: () => ({ agentId, threadId: remoteId }),
        prepareSendMessagesRequest: ({ messages, body, id }) => {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
          const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');

          // 检测 approval 自动发送：将 assistant 消息中的 approval-responded 状态
          // 转换为服务端可识别的 tool-approval-response 消息格式
          const approvalResponses = lastAssistantMsg?.parts
            ?.filter(
              (p: any) =>
                p.state === 'approval-responded' &&
                p.approval?.id != null,
            )
            .map((p: any) => ({
              type: 'tool-approval-response',
              approvalId: p.approval.id,
              approved: p.approval.approved ?? false,
            })) ?? [];

          if (approvalResponses.length > 0) {
            return {
              body: {
                ...body,
                id: remoteId,
                messages: [{ role: 'user', parts: approvalResponses }],
              },
            };
          }

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
    // 当所有审批决议就绪时自动发送（无需用户手动输入消息）
    sendAutomaticallyWhen: ({ messages }) => {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (!lastAssistant) return false;
      // 查找所有带 approval 属性的工具部件（不管当前 state 是什么）
      const approvalParts = lastAssistant.parts?.filter(
        p => 'approval' in p && (p as any).approval != null,
      ) ?? [];
      if (approvalParts.length === 0) return false;
      // addToolApprovalResponse 将部件的 state 改为 'approval-responded'
      return approvalParts.every(p => (p as any).state === 'approval-responded');
    },
    onFinish: ({ message }) => {
      const meta = (message as any)?.metadata;
      // 新线程首次发送后，后端返回真实 threadId
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
}
