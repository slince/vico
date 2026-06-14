// 1. React
import { useEffect, useRef } from 'react';

// 2. Third-party

// 3. API

// 4. UI components
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

// 5. Sub-components
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { ExecApprovalCard } from '@/components/ExecApprovalCard';

// 6. Types
import type { ChatMessage } from '../Chat';

interface ChatWindowProps {
  agentName: string;
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  loadingMessages: boolean;
}

/**
 * 聊天窗口 — 消息列表 + 输入框。
 *
 * 显示对话消息、流式输出内容，支持滚动到底部。
 */
export function ChatWindow({
  agentName,
  messages,
  streamingContent,
  isStreaming,
  onSend,
  onStop,
  loadingMessages,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息到来时自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* 顶部标题栏 */}
      <div className="h-12 flex items-center px-4 border-b shrink-0">
        <span className="text-sm font-medium">{agentName}</span>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1 min-h-0">
        {loadingMessages ? (
          <div className="max-w-3xl mx-auto space-y-4 p-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <Skeleton className="h-20 w-3/4 rounded-lg" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            发送消息开始对话
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4 p-6">
            {messages.map((msg) => (
              <div key={msg.id}>
                <MessageBubble message={msg} />
                {msg.pendingApproval && (
                  <div className="flex justify-start max-w-3xl mx-auto">
                    <div className="max-w-[85%]">
                      <ExecApprovalCard command={msg.pendingApproval.command} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* 流式输出中的 AI 回复 */}
            {isStreaming && streamingContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  created_at: new Date().toISOString(),
                }}
                isStreaming
              />
            )}

            {/* 流式等待状态 */}
            {isStreaming && !streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-4 py-3 bg-accent text-accent-foreground">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.3s]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* 底部输入区 */}
      <ChatInput onSend={onSend} onStop={onStop} isStreaming={isStreaming} />
    </div>
  );
}
