// 1. React
import { useState, useCallback, useRef, useEffect } from 'react';

// 2. Third-party
import { Send, Square } from 'lucide-react';

// 3. API

// 4. UI components
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

/**
 * 聊天输入框 — 支持 Enter 发送、Shift+Enter 换行。
 *
 * 流式输出中显示"停止"按钮，否则显示"发送"按钮。
 */
export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动聚焦
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 流式结束后重新聚焦
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isStreaming) {
          handleSend();
        }
      }
    },
    [handleSend, isStreaming]
  );

  return (
    <div className="border-t p-3 shrink-0">
      <div className="max-w-3xl mx-auto flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          className="min-h-10 max-h-40 resize-none"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button type="button" variant="destructive" size="icon" onClick={onStop}>
            <Square size={16} />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            <Send size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
