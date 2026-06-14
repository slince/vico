// 1. React
import { useState, useCallback, useRef, useEffect } from 'react';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';

// 3. API
import { api, streamChat } from '@/api/client';

// 4. UI components

// 5. Sub-components
import { ChatSidebar } from './chat/ChatSidebar';
import { ChatWindow } from './chat/ChatWindow';
import { ChatSkeleton } from './chat/ChatSkeleton';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';

// 6. Types
// ChatMessage type exported for sub-components

interface Agent {
  id: string;
  name: string;
}

/** 主 Agent — 内置通用调度器，非 DB 记录 */
const MAIN_AGENT: Agent = { id: 'main', name: 'Vico' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** 待处理的执行审批（来自 approval_required SSE 事件） */
  pendingApproval?: { command: string };
}

/**
 * Chat — 实时对话界面。
 *
 * 左侧显示 Agent 选择器和对话列表，右侧为聊天窗口。
 * 支持 SSE 流式响应、对话切换、新建对话。
 * URL 路由：/chat 或 /chat/:conversationId
 */
export default function Chat() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeConversationId, setActiveConversationId] = useState<string>(conversationId || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // 获取 Agent 列表
  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  // 加载历史对话的消息
  useEffect(() => {
    if (!conversationId) {
      // 新对话，清空消息
      if (!activeConversationId) {
        setMessages([]);
      }
      return;
    }

    setActiveConversationId(conversationId);
    setLoadingMessages(true);

    api<{ messages: ChatMessage[]; agent_id: string }>(`/conversations/${conversationId}`)
      .then((data) => {
        setMessages(data.messages || []);
        if (data.agent_id) setSelectedAgentId(data.agent_id);
      })
      .catch(() => {
        setMessages([]);
      })
      .finally(() => {
        setLoadingMessages(false);
      });
  }, [conversationId]);

  // 确保 agent 选择与 URL 参数同步
  useEffect(() => {
    if (conversationId) {
      setActiveConversationId(conversationId);
    }
  }, [conversationId]);

  /** 发送消息 */
  const handleSend = useCallback(
    (text: string) => {
      if (!selectedAgentId || !text.trim()) return;

      // 如果之前有流在进行，先中止
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const convId = activeConversationId || '';
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent('');

      let assistantContent = '';
      let pendingApprovalRef: { command: string } | null = null;

      abortRef.current = streamChat(
        { agentId: selectedAgentId, conversationId: convId, message: text },
        (event) => {
          if (event.type === 'text_delta') {
            assistantContent += event.content || '';
            setStreamingContent(assistantContent);
          } else if (event.type === 'approval_required') {
            // 记录审批请求，在 onDone 中附加到最终消息
            pendingApprovalRef = { command: event.command };
            setStreamingContent(
              assistantContent + `\n\n[Exec Approval Required]\nCommand: ${event.command}\n`
            );
          }
        },
        () => {
          // onError
          setIsStreaming(false);
          setStreamingContent('');
        },
        () => {
          // onDone
          setIsStreaming(false);
          const newMsg: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: assistantContent,
            created_at: new Date().toISOString(),
            pendingApproval: pendingApprovalRef || undefined,
          };
          setMessages((prev) => [...prev, newMsg]);
          setStreamingContent('');

          // 首次对话后，更新 URL 以保持对话
          if (!convId) {
            // 对话 ID 由服务端返回，这里用 threadId 不便获取
            // 新对话完成后刷新对话列表
          }
        }
      );
    },
    [selectedAgentId, activeConversationId]
  );

  /** 停止生成 */
  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsStreaming(false);
    setStreamingContent('');
  }, []);

  /** 新建对话 */
  const handleNewChat = useCallback(() => {
    // 如果有流在进行，先中止
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setActiveConversationId('');
    setMessages([]);
    setIsStreaming(false);
    setStreamingContent('');
    // 更新 URL 到 /chat
    navigate('/chat', { replace: true });
  }, [navigate]);

  /** 选择对话 */
  const handleSelectConversation = useCallback(
    (convId: string) => {
      if (convId === activeConversationId) return;
      // 如果有流在进行，先中止
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setIsStreaming(false);
      setStreamingContent('');
      setActiveConversationId(convId);
      navigate(`/chat/${convId}`, { replace: true });
    },
    [activeConversationId, navigate]
  );

  /** 选择 Agent */
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      // 如果当前有对话内容，提示用户确认是否切换
      if (messages.length > 0) {
        handleNewChat();
      }
    },
    [messages.length, handleNewChat]
  );

  if (agentsLoading) {
    return <ChatSkeleton />;
  }

  const agentList: Agent[] = [MAIN_AGENT, ...(agents ?? [])];
  const selectedAgent = agentList.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      {/* 左侧面板 */}
      <ChatSidebar
        agents={agentList}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
      />

      {/* 右侧聊天区 */}
      {selectedAgentId ? (
        <ChatWindow
          agentName={selectedAgent?.name || selectedAgentId}
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          onSend={handleSend}
          onStop={handleStop}
          loadingMessages={loadingMessages}
        />
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
