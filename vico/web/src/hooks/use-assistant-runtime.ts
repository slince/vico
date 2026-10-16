/**
 * Assistant UI Runtime hook — 使用 useRemoteThreadListRuntime 连接后端对话列表。
 *
 * 与 Chat.tsx 中 AssistantRuntimeProvider 配合使用：
 * - 通过 RemoteThreadListAdapter 从 /api/v1/threads 加载线程列表
 * - 每个线程通过 runtimeHook 创建独立的 useChatRuntime 实例
 * - 支持历史消息加载和 threadId 回写
 */
import {useMemo} from 'react';
import {useRemoteThreadListRuntime} from '@assistant-ui/react';
import {createThreadListAdapter} from '@/lib/thread-adapter';
import {useChatThreadRuntime} from '@/hooks/use-chat-thread-runtime';

export interface UseAssistantRuntimeOptions {
  /** 固定 Agent ID（Agent 详情页测试对话区传入）；Chat 路由不传，由 composer 选中态决定 */
  agentId?: string;
  /** 可选的 thread ID，用于加载历史消息和继续对话 */
  threadId?: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 是否启用运行时与线程列表请求，非 Chat 路由关闭 */
  enabled?: boolean;
}

/**
 * 创建 Assistant UI 聊天运行时，集成远程对话列表。
 *
 * 线程列表通过 RemoteThreadListAdapter 从后端加载，
 * 每个线程独立创建 useChatRuntime 实例处理消息。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例；enabled 为 false 时返回 null
 */
export function useAssistantRuntime({agentId, threadId, onThreadCreated, onError, enabled = true,}: UseAssistantRuntimeOptions) {
  // 线程列表适配器 — 传入 agentId 时按该 Agent 过滤；否则列出全部线程
  const adapter = useMemo(() => createThreadListAdapter(agentId, enabled), [agentId, enabled]);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook:  () => {
      return useChatThreadRuntime({ agentId, onThreadCreated, onError });
    },
    adapter,
    threadId,
  });

  return enabled ? runtime : null;
}
