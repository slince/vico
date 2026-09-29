// 1. React
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// 2. Third-party
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AssistantRuntimeProvider,
  Tools,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { DevToolsModal } from '@assistant-ui/react-devtools';

// 3. API / Hooks
import { api } from '@/api/client';
import { useAssistantRuntime } from '@/hooks/use-assistant-runtime';
import { useThread } from '@/hooks/use-thread';
import { toolkit } from '@/tools/toolkit';

// 4. 类型
import type { Agent } from '@/types/models';

/** Chat 全局状态上下文 — 供全局 Sidebar（会话列表）与 Chat 页面（聊天区）共享 */
interface ChatContextType {
  /** Agent 列表（仅在 Chat 路由下加载） */
  agents: Agent[];
  /** Agent 列表是否加载中 */
  agentsLoading: boolean;
  /** 当前选中的 Agent，未选中时为 null */
  selectedAgent: Agent | null;
  /** 当前 URL 中的 threadId（/chat/:threadId），无则为空串 */
  threadId: string;
  /** 是否处于 Chat 路由（/chat 或 /chat/:threadId） */
  isChatRoute: boolean;
  /** 选择 Agent — 清除线程并回到 /chat */
  selectAgent: (agent: Agent) => void;
  /** 选择第一个 Agent（空态按钮） */
  selectFirstAgent: () => void;
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

  useEffect(() => {
    // 仅同步真实后端 ID，跳过本地临时 ID；避免与当前 URL 重复导航
    if (remoteId && !remoteId.startsWith('__LOCALID_') && remoteId !== threadId) {
      navigate(`/chat/${remoteId}`, { replace: true });
    }
  }, [remoteId, threadId, navigate]);

  return null;
}

/**
 * Chat 全局 Provider — 将 Agent 选择、线程路由、AssistantRuntime 提升到 Layout 层。
 *
 * 原本次三者都封装在 Chat 页面内，导致会话列表（ThreadList）只能与聊天区同处
 * 一个组件树；提升后全局 Sidebar 也能在 AssistantRuntimeProvider 内渲染会话列表。
 *
 * 仅在 Chat 路由下创建 runtime / 请求 Agent 列表，避免其它页面产生多余开销。
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

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // 首次对话创建 thread 后回写 URL
  const handleThreadCreated = useCallback(
    (newThreadId: string) => {
      navigate(`/chat/${newThreadId}`, { replace: true });
      queryClient.invalidateQueries({ queryKey: ['threads', selectedAgent?.id] });
    },
    [navigate, queryClient, selectedAgent?.id],
  );

  const runtime = useAssistantRuntime({
    agentId: isChatRoute ? (selectedAgent?.id ?? '') : '',
    threadId: threadId || undefined,
    onThreadCreated: handleThreadCreated,
  });

  const aui = useAui({ tools: Tools({ toolkit }) });

  // 获取 Agent 列表（仅在 Chat 路由下请求）
  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
    enabled: isChatRoute,
  });

  // 页面刷新时，从 URL threadId 查询对应 Agent 以恢复状态
  const { data: thread } = useThread(threadId);
  const threadAgentId = thread?.agentId;

  const agentList: Agent[] = agents ?? [];

  // 自动选中 URL 中 thread 对应的 Agent
  useEffect(() => {
    if (threadAgentId && agentList.length > 0 && selectedAgent?.id !== threadAgentId) {
      const agent = agentList.find((a) => a.id === threadAgentId);
      if (agent) setSelectedAgent(agent);
    }
  }, [threadAgentId, agentList, selectedAgent]);

  // 进入 Chat 页面（无 threadId）时默认选中 main agent
  useEffect(() => {
    if (!threadId && agentList.length > 0 && !selectedAgent) {
      const defaultAgent = agentList.find((a) => a.is_default === 1);
      if (defaultAgent) setSelectedAgent(defaultAgent);
    }
  }, [threadId, agentList, selectedAgent]);

  /** 选择 Agent — 清除线程并回到 /chat */
  const selectAgent = useCallback(
    (agent: Agent) => {
      setSelectedAgent(agent);
      navigate('/chat', { replace: true });
    },
    [navigate],
  );

  /** 选择第一个 Agent（空态按钮） */
  const selectFirstAgent = useCallback(() => {
    if (agentList.length > 0) setSelectedAgent(agentList[0]);
  }, [agentList]);

  const value = useMemo<ChatContextType>(
    () => ({
      agents: agentList,
      agentsLoading,
      selectedAgent,
      threadId,
      isChatRoute,
      selectAgent,
      selectFirstAgent,
    }),
    [agentList, agentsLoading, selectedAgent, threadId, isChatRoute, selectAgent, selectFirstAgent],
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
