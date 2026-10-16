// 1. React
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

// 2. Third-party
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AssistantRuntimeProvider,
  Tools,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { DevToolsModal } from '@assistant-ui/react-devtools';

// 3. API / Hooks
import { useAssistantRuntime } from '@/hooks/use-assistant-runtime';
import { toolkit } from '@/tools/toolkit';

/** Chat 全局状态上下文 — 供全局 Sidebar（会话列表）与 Chat 页面（聊天区）共享 */
interface ChatContextType {
  /** 当前 URL 中的 threadId（/chat/:threadId），无则为空串 */
  threadId: string;
  /** 是否处于 Chat 路由（/chat 或 /chat/:threadId） */
  isChatRoute: boolean;
}

const ChatContext = createContext<ChatContextType | null>(null);

/** 从 pathname 解析 threadId：/chat/:threadId → threadId，否则返回空串 */
function getThreadIdFromPath(pathname: string): string {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  return match?.[1] ?? '';
}

/**
 * 监听 runtime 主线程切换并同步 URL。
 *
 * 必须在 AssistantRuntimeProvider 内部使用（依赖 useAuiState 上下文）。
 * 仅同步真实后端 ID，跳过本地临时 ID（__LOCALID_ 前缀）。
 */
function ThreadUrlSync() {
  const { threadId } = useChat();
  const navigate = useNavigate();

  // threadItems 为数组，需根据 mainThreadId 查找对应项的 remoteId
  const remoteId = useAuiState((s) => {
    const item = s.threads.threadItems.find((i) => i.id === s.threads.mainThreadId);
    return item?.remoteId;
  });

  // 记录上一次 remoteId，仅在 runtime 主线程切换（remoteId 真正变化）时同步 URL。
  // 否则点击「对话」回到 /chat 时，URL 的 threadId 先变为空、而 runtime 尚未异步
  // 切到新本地线程（remoteId 仍是旧值），会误触发回跳。
  const prevRemoteIdRef = useRef(remoteId);

  useEffect(() => {
    const prev = prevRemoteIdRef.current;
    prevRemoteIdRef.current = remoteId;

    // 仅同步真实后端 ID，跳过本地临时 ID；仅当 remoteId 变化时才同步，避免瞬时回跳
    if (remoteId === prev) return;
    if (remoteId && !remoteId.startsWith('__LOCALID_') && remoteId !== threadId) {
      navigate(`/chat/${remoteId}`, { replace: true });
    }
  }, [remoteId, threadId, navigate]);

  return null;
}

/**
 * Chat 全局 Provider — 只负责线程路由与 AssistantRuntime 的装配，不再感知 Agent。
 *
 * Agent 选择已下沉到聊天区 composer（AgentSelectorAction → config.agentId），
 * 因此 runtime 不再按 Agent 重建、线程列表也不再按 Agent 过滤。
 *
 * 仅在 Chat 路由下创建 runtime，避免其它页面产生多余开销。
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isChatRoute =
    location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const threadId = useMemo(
    () => getThreadIdFromPath(location.pathname),
    [location.pathname],
  );

  // 首次对话创建 thread 后回写 URL，并刷新设置页的会话记录
  const handleThreadCreated = useCallback(
    (newThreadId: string) => {
      navigate(`/chat/${newThreadId}`, { replace: true });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
    [navigate, queryClient],
  );

  const runtime = useAssistantRuntime({
    threadId: threadId || undefined,
    onThreadCreated: handleThreadCreated,
    enabled: isChatRoute,
  });

  const aui = useAui({ tools: Tools({ toolkit }) });

  const value = useMemo<ChatContextType>(
    () => ({ threadId, isChatRoute }),
    [threadId, isChatRoute],
  );

  return (
    <ChatContext.Provider value={value}>
      {runtime ? (
        <AssistantRuntimeProvider runtime={runtime} aui={aui} i18nIsDynamicList>
          <DevToolsModal />
          <ThreadUrlSync />
          {children}
        </AssistantRuntimeProvider>
      ) : (
        children
      )}
    </ChatContext.Provider>
  );
}

/** 读取 Chat 全局状态，必须在 ChatProvider 内使用 */
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
