import { useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
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
import { useTeamChat } from '@/hooks/useTeamChat';

/** TeamChatPanel 组件的 props */
export interface TeamChatPanelProps {
  /** 当前团队 ID */
  teamId: string;
}

/**
 * 团队对话测试面板
 *
 * 提供团队协作的实时对话测试区域，支持：
 * - 消息列表展示（用户、助手和委派事件）
 * - SSE 流式响应（实时打字效果）
 * - 委派事件展示（蓝色气泡 + Agent 名称）
 * - 回车发送、Shift+Enter 换行
 */
export default function TeamChatPanel({ teamId }: TeamChatPanelProps) {
  const { messages, input, handleInputChange, sendMessage, isLoading } = useTeamChat({ teamId });
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <Card className="flex flex-col h-[calc(100vh-14rem)]">
      <CardHeader className="pb-3">
        <CardTitle>团队对话测试</CardTitle>
        <CardDescription>
          向团队发送消息，观察协调者如何分配任务
        </CardDescription>
      </CardHeader>

      <Separator />

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
                  在下方输入消息，测试团队协作效果
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
                    : msg.role === 'delegation'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                      : 'bg-accent'
                }`}
              >
                {msg.role === 'delegation' && msg.agentName && (
                  <p className="text-xs font-semibold mb-1">
                    {msg.agentName}
                  </p>
                )}
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
              <span>→</span>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
