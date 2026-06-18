// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';

// 3. API
import { api } from '@/api/client';

// 4. Sub-components
import { ChatSidebar } from './chat/ChatSidebar';
import { AgentChatPanel } from './chat/AgentChatPanel';
import { AgentChatEmpty } from './chat/AgentChatEmpty';
import { ChatSkeleton } from './chat/ChatSkeleton';
import { useAssistantRuntime } from '@/hooks/useAssistantRuntime';

// 5. Types
interface Agent {
  id: string;
  name: string;
}

/**
 * Chat — 聊天页面。
 *
 * 左侧 ChatSidebar（Agent 选择 + 对话列表），
 * 右侧选中时渲染 AgentChatPanel，未选中时渲染 AgentChatEmpty。
 * URL 路由：/chat 或 /chat/:threadId
 */
export default function Chat() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeThreadId, setActiveThreadId] = useState<string>(threadId || '');

  // 首次对话创建 thread 后回写 URL 并刷新对话列表
  const handleThreadCreated = useCallback(
    (newThreadId: string) => {
      setActiveThreadId(newThreadId);
      navigate(`/chat/${newThreadId}`, { replace: true });
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgentId] });
    },
    [navigate, queryClient, selectedAgentId],
  );

  const runtime = useAssistantRuntime({
    agentId: selectedAgentId,
    threadId: activeThreadId || undefined,
    onThreadCreated: handleThreadCreated,
  });

  // 获取 Agent 列表
  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  /** 选择对话 */
  const handleSelectThread = useCallback(
    (tid: string) => {
      if (tid === activeThreadId) return;
      setActiveThreadId(tid);
      navigate(`/chat/${tid}`, { replace: true });
    },
    [activeThreadId, navigate],
  );

  /** 新建对话 */
  const handleNewChat = useCallback(() => {
    setActiveThreadId('');
    navigate('/chat', { replace: true });
  }, [navigate]);

  /** 选择 Agent */
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      handleNewChat();
    },
    [handleNewChat],
  );

  if (agentsLoading) return <ChatSkeleton />;

  const agentList: Agent[] = agents ?? [];
  const selectedAgent = agentList.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      <ChatSidebar
        agents={agentList}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
      />

      {selectedAgentId && runtime ? (
        <AgentChatPanel
          runtime={runtime}
          agentName={selectedAgent?.name || selectedAgentId}
        />
      ) : (
        <AgentChatEmpty
          hasAgents={agentList.length > 0}
          onSelectFirstAgent={() => setSelectedAgentId(agentList[0].id)}
        />
      )}
    </div>
  );
}
