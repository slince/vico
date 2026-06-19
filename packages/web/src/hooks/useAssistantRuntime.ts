/**
 * Assistant UI Runtime hook — 使用 useRemoteThreadListRuntime 连接后端对话列表。
 *
 * 与 Chat.tsx 中 AssistantRuntimeProvider 配合使用：
 * - 通过 RemoteThreadListAdapter 从 /api/v1/conversations 加载对话列表
 * - 每个线程通过 runtimeHook 创建独立的 useChatRuntime 实例
 * - 支持历史消息加载和 threadId 回写
 */
import {useMemo} from 'react';
import {useRemoteThreadListRuntime} from '@assistant-ui/react';
import {createConversationThreadAdapter} from '@/lib/conversation-thread-adapter';
import {useChatThreadRuntime} from '@/hooks/useChatThreadRuntime';

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
export function useAssistantRuntime({agentId, threadId, onThreadCreated, onError,}: UseAssistantRuntimeOptions) {
  // 对话列表适配器 — 按 agentId 过滤
  const adapter = useMemo(() => createConversationThreadAdapter(agentId), [agentId]);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook:  () => {
      return useChatThreadRuntime({ agentId, onThreadCreated, onError });
    },
    adapter,
    threadId,
  });

  // 没有选择 agent 不需要runtime
  return agentId ? runtime : null;
}
