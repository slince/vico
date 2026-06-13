import { useRef, useEffect, useCallback } from 'react';
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
import { streamChat } from '@/api/client';

import type { ChatMessage } from './types';

/** ChatPanel 组件的 props */
export interface ChatPanelProps {
  /** 当前 Agent ID，用于发起聊天请求 */
  agentId: string;
  /** 聊天消息列表 */
  messages: ChatMessage[];
  /** 更新消息列表的 setter */
  onMessagesChange: (
    updater: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  /** 当前输入框内容 */
  input: string;
  /** 更新输入框内容的 setter */
  onInputChange: (value: string) => void;
  /** 是否正在流式响应中 */
  streaming: boolean;
  /** 设置流式响应状态 */
  onStreamingChange: (value: boolean) => void;
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
export default function ChatPanel({
  agentId,
  messages,
  onMessagesChange,
  input,
  onInputChange,
  streaming,
  onStreamingChange,
}: ChatPanelProps) {
  // 聊天消息容器的 ref，用于自动滚动到底部
  const chatEndRef = useRef<HTMLDivElement>(null);

  /**
   * 发送聊天消息并处理 SSE 流式响应
   *
   * 通过 streamChat 建立 SSE 连接，收到 text_delta 事件时
   * 实时更新助手消息内容，完成后设置 streaming 状态为 false。
   */
  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming || !agentId) return;

    // 追加用户消息到列表
    onMessagesChange((prev) => [...prev, { role: 'user', content: input }]);
    onStreamingChange(true);

    // 累积流式响应的完整文本
    let fullResponse = '';

    streamChat(
      { agentId, message: input },
      // onEvent：处理 SSE 事件
      (event) => {
        if (event.type === 'text_delta') {
          fullResponse += event.content;
          // 使用函数式更新以获取最新消息列表，避免闭包陈旧问题
          onMessagesChange((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { role: 'assistant', content: fullResponse },
              ];
            }
            return [...prev, { role: 'assistant', content: fullResponse }];
          });
        }
      },
      // onError：处理错误
      (err) => {
        onMessagesChange((prev) => [
          ...prev,
          { role: 'assistant', content: `错误: ${err.message}` },
        ]);
        onStreamingChange(false);
      },
      // onDone：流结束
      () => onStreamingChange(false),
    );

    // 清空输入框
    onInputChange('');
  }, [input, streaming, agentId, onMessagesChange, onStreamingChange, onInputChange]);

  /** 聊天消息更新后自动滚动到底部 */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

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
            {/* 空消息提示 */}
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

            {/* 消息列表 */}
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

            {/* 流式响应指示器 */}
            {streaming && (
              <div className="flex justify-start mb-3">
                <div className="flex items-center gap-2 bg-accent rounded-lg px-3 py-2">
                  <Spinner className="size-3.5" />
                  <span className="text-xs text-muted-foreground">
                    正在生成...
                  </span>
                </div>
              </div>
            )}

            {/* 滚动锚点：新消息自动滚动到此 */}
            <div ref={chatEndRef} />
          </ScrollArea>
        </CardContent>

        <Separator />

        {/* 输入区域 */}
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              // 回车发送，Shift+Enter 换行
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="输入测试消息，Enter 发送..."
              disabled={streaming}
              className="flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              size="icon"
            >
              {streaming ? (
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
