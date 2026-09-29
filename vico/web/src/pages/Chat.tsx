// 1. React
// （无本地状态，Agent 选择与线程路由均已提升至 ChatProvider）

// 2. Hooks
import {useChat} from '@/providers/chat-provider';

// 3. 页面子组件
import {ChatPanel} from './chat/ChatPanel';
import {ChatEmpty} from './chat/ChatEmpty';
import {ChatSkeleton} from './chat/ChatSkeleton';

/**
 * Chat — 聊天页面。
 *
 * Agent 选择、线程路由、AssistantRuntime 均已提升至 ChatProvider（Layout 层），
 * 会话列表由全局 Sidebar 渲染，本页面仅负责右侧聊天区（ChatPanel / 空态）。
 *
 * URL 路由：/chat 或 /chat/:threadId
 */
export default function Chat() {
  const { agents, agentsLoading, selectedAgent, threadId, selectFirstAgent } = useChat();

  if (agentsLoading) return <ChatSkeleton />;

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      {selectedAgent ? (
        <ChatPanel agent={selectedAgent} threadId={threadId || undefined} />
      ) : (
        <ChatEmpty
          hasAgents={agents.length > 0}
          onSelectFirstAgent={selectFirstAgent}
        />
      )}
    </div>
  );
}
