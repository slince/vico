// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';

// 5. Sub-components
import { ChatSidebar } from './chat/ChatSidebar';
import { ChatSkeleton } from './chat/ChatSkeleton';
import { useAssistantRuntime } from '@/hooks/useAssistantRuntime';
import { WeatherToolUI } from './chat/ToolUIs/weather-ui';
import { ExecToolUI } from './chat/ToolUIs/exec-ui';

// 6. Types
interface Agent {
  id: string;
  name: string;
}

/**
 * Chat — 聊天页面，使用 Assistant UI 全家桶。
 *
 * 左侧 ChatSidebar（Agent 选择 + 对话列表），
 * 右侧 Assistant UI Thread + Composer 组件。
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
      {/* 左侧面板 */}
      <ChatSidebar
        agents={agentList}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
      />

      {/* 右侧聊天区 */}
      {selectedAgentId ? (
        <AssistantRuntimeProvider runtime={runtime}>
          <WeatherToolUI />
          <ExecToolUI />
          <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* 顶部标题栏 */}
            <div className="h-12 flex items-center px-4 border-b shrink-0">
              <span className="text-sm font-medium">
                {selectedAgent?.name || selectedAgentId}
              </span>
            </div>

            {/* Thread 区域 */}
            <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0">
              <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-2">
                <ThreadPrimitive.Empty>
                  <Empty>
                    <EmptyMedia variant="icon">
                      <MessageCircle size={32} className="text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>开始对话</EmptyTitle>
                    <EmptyDescription>发送消息开始与 Agent 对话</EmptyDescription>
                  </Empty>
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages>
                  {({ message }) => {
                    if (message.role === 'user') {
                      return (
                        <div className="flex justify-end mb-4">
                          <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
                            {message.parts.map((part: any) =>
                              part.type === 'text' ? <span key={part.id}>{part.text}</span> : null,
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="flex justify-start mb-4">
                        <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-accent">
                          {message.parts.map((part: any) =>
                            part.type === 'text' ? <span key={part.id}>{part.text}</span> : null,
                          )}
                        </div>
                      </div>
                    );
                  }}
                </ThreadPrimitive.Messages>
                <ThreadPrimitive.ScrollToBottom />
              </ThreadPrimitive.Viewport>

              {/* Composer 输入区域 */}
              <div className="border-t shrink-0 p-3">
                <ComposerPrimitive.Root className="flex items-end gap-2">
                  <ComposerPrimitive.Input
                    className="flex-1 min-h-10 max-h-40 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="输入消息..."
                    autoFocus
                  />
                  <ComposerPrimitive.Send
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                    disabled={!runtime}
                  />
                </ComposerPrimitive.Root>
              </div>
            </ThreadPrimitive.Root>
          </div>
        </AssistantRuntimeProvider>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background">
          <Empty>
            <EmptyMedia variant="icon">
              <MessageCircle size={32} className="text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>开始对话</EmptyTitle>
            <EmptyDescription>选择一个 Agent 开始对话</EmptyDescription>
            {agentList.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setSelectedAgentId(agentList[0].id)}
              >
                选择 Agent
              </Button>
            )}
          </Empty>
        </div>
      )}
    </div>
  );
}
