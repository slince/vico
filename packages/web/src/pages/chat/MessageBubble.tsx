// 1. React

// 2. Third-party
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 3. API

// 4. UI components
import { cn } from '@/lib/utils';

// 5. Types
import type { ChatMessage } from '../Chat';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

/**
 * 聊天消息气泡。
 *
 * 用户消息右对齐（primary 色），AI 消息左对齐（accent 色）。
 * AI 消息内容以 Markdown 渲染（支持 GFM 扩展）。
 * isStreaming 时在 AI 回复末尾显示闪烁光标。
 */
export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground'
        )}
      >
        <div className={cn('text-sm break-words', !isUser && 'prose prose-sm dark:prose-invert max-w-none')}>
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          )}
          {isStreaming && (
            <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}
