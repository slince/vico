// 1. React
import {useCallback, useState} from 'react';

// 2. Third-party
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useParams} from 'react-router-dom';
import {AssistantRuntimeProvider} from '@assistant-ui/react';

// 3. API
import {api} from '@/api/client';

// 4. Sub-components
import {ChatSidebar} from './chat/ChatSidebar';
import {ChatPanel} from './chat/ChatPanel';
import {ChatEmpty} from './chat/ChatEmpty';
import {ChatSkeleton} from './chat/ChatSkeleton';
import {useAssistantRuntime} from '@/hooks/useAssistantRuntime';

// 5. Types
interface Agent {
  id: string;
  name: string;
}

/**
 * Chat — 聊天页面。
 *
 * AssistantRuntimeProvider 包裹左侧 Sidebar（ThreadListSidebar 风格）和右侧 ChatPanel，
 * 两者共享同一个 AssistantRuntime，ThreadList 和 Thread 通过上下文通信。
 *
 * URL 路由：/chat 或 /chat/:threadId
 */
export default function Chat() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeThreadId, setActiveThreadId] = useState<string>(threadId || '');

  // 首次对话创建 thread 后回写 URL
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

  /** ThreadList 选中线程时同步 URL */
  const handleThreadChange = useCallback((tid: string) => {
      if (tid === activeThreadId) return;
      setActiveThreadId(tid);
      navigate(`/chat/${tid}`, { replace: true });
    },
    [activeThreadId, navigate],
  );

  /** 选择 Agent — 清除线程并回到 /chat */
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      setActiveThreadId('');
      navigate('/chat', { replace: true });
    },
    [navigate],
  );

  if (agentsLoading) return <ChatSkeleton />;

  const agentList: Agent[] = agents ?? [];
  const selectedAgent = agentList.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      {selectedAgentId && runtime ? (
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatSidebar
            agents={agentList}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            onThreadChange={handleThreadChange}
          />

          <ChatPanel
            agentName={selectedAgent?.name || selectedAgentId}
          />
        </AssistantRuntimeProvider>
      ) : (
        <>
          <ChatSidebar
            agents={agentList}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
          />
          <ChatEmpty
            hasAgents={agentList.length > 0}
            onSelectFirstAgent={() => setSelectedAgentId(agentList[0].id)}
          />
        </>
      )}
    </div>
  );
}
