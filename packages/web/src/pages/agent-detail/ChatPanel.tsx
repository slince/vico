import { useRef, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { useAgentChat } from '@/hooks/useAgentChat';

/** ChatPanel 组件的 props */
export interface ChatPanelProps {
  /** 当前 Agent ID，用于发起聊天请求 */
  agentId: string;
}

/**
 * 测试对话面板
 *
 * 提供 Agent 的实时对话测试区域，支持：
 * - 消息列表展示（用户消息右对齐、助手消息左对齐）
 * - SSE 流式响应（实时打字效果）
 * - 回车发送、Shift+Enter 换行
 * - 空消息时显示引导提示
 * - 自动滚动到最新消息
 *
 * @param props - 组件属性
 * @returns 测试对话面板 JSX 元素
 */
export default function ChatPanel({ agentId }: ChatPanelProps) {
  const { messages, input, handleInputChange, sendMessage, isLoading } = useAgentChat({ agentId });
  const chatEndRef = useRef<HTMLDivElement>(null);

  /** 自动滚动到底部 */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="mt-4">
      <Card className="flex flex-col h-[calc(100vh-14rem)]">
        <CardHeader className="pb-3">
          <CardTitle>预览 &amp; 测试对话</CardTitle>
          <CardDescription>
            在此测试当前配置下的 Agent 效果，所有对话均为临时会话
          </CardDescription>
        </CardHeader>

        <Separator />

        {/* 消息列表区域 */}
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full px-4 py-3">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full py-20">
                <Empty>
                  <EmptyMedia variant="icon">
                    <MessageSquare size={24} />
                  </EmptyMedia>
                  <EmptyTitle>开始测试</EmptyTitle>
                  <EmptyDescription>
                    在下方输入消息，体验 Agent 的回复效果
                  </EmptyDescription>
                </Empty>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex mb-3 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {msg.content || '...'}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start mb-3">
                <div className="flex items-center gap-2 bg-accent rounded-lg px-3 py-2">
                  <Spinner className="size-3.5" />
                  <span className="text-xs text-muted-foreground">
                    正在生成...
                  </span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </ScrollArea>
        </CardContent>

        <Separator />

        {/* 输入区域 */}
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="输入测试消息，Enter 发送..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              size="icon"
            >
              {isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <Send size={16} />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
