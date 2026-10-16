// 1. React
// （无本地状态，Agent 选择已下沉到 composer，线程路由由 ChatProvider 管理）

// 2. Hooks
import {useChat} from '@/providers/chat-provider';

// 3. 页面子组件
import {ChatPanel} from './chat/ChatPanel';

/**
 * Chat — 聊天页面。
 *
 * 线程路由、AssistantRuntime 均已提升至 ChatProvider（Layout 层），
 * 会话列表由全局 Sidebar 渲染，本页面仅负责右侧聊天区（ChatPanel）。
 * Agent 选择由 ChatPanel 内 composer 的 AgentSelectorAction 负责。
 *
 * URL 路由：/chat 或 /chat/:threadId
 */
export default function Chat() {
  const { threadId } = useChat();

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      <ChatPanel threadId={threadId || undefined} />
    </div>
  );
}
