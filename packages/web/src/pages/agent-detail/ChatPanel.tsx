import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import { useAgentChat } from '@/hooks/useAgentChat';
import { ExecApprovalCard } from '@/components/ExecApprovalCard';

export interface ChatPanelProps {
  agentId: string;
}

/**
 * 测试对话面板
 *
 * 提供 Agent 的实时对话测试区域，支持 SSE 流式响应。
 */
export default function ChatPanel({ agentId }: ChatPanelProps) {
  const { t } = useTranslation('agents');
  const { messages, input, handleInputChange, sendMessage, isLoading } = useAgentChat({ agentId });
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="mt-4">
      <Card className="flex flex-col h-[calc(100vh-14rem)]">
        <CardHeader className="pb-3">
          <CardTitle>{t('chatPreview')}</CardTitle>
          <CardDescription>{t('chatPreviewDesc')}</CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full min-h-0 px-4 py-3">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full py-20">
                <Empty>
                  <EmptyMedia variant="icon">
                    <MessageSquare size={24} />
                  </EmptyMedia>
                  <EmptyTitle>{t('chatEmptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t('chatEmptyDesc')}</EmptyDescription>
                </Empty>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div
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
                {msg.pendingApproval && (
                  <div className="flex justify-start mb-3">
                    <div className="max-w-[80%]">
                      <ExecApprovalCard command={msg.pendingApproval.command} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start mb-3">
                <div className="flex items-center gap-2 bg-accent rounded-lg px-3 py-2">
                  <Spinner className="size-3.5" />
                  <span className="text-xs text-muted-foreground">
                    {t('common:generating')}
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
              placeholder={t('chatPlaceholder')}
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
