import { useState, useCallback } from 'react';
import { streamTeamChat } from '@/api/client';
import type { ChatMessage } from '@/pages/team-detail/types';

/** useTeamChat 的配置选项 */
export interface UseTeamChatOptions {
  /** 当前团队 ID */
  teamId: string;
  /** 可选：初始消息列表 */
  initialMessages?: ChatMessage[];
}

/** useTeamChat 的返回值 */
export interface UseTeamChatReturn {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 输入框内容 */
  input: string;
  /** 更新输入框内容 */
  handleInputChange: (value: string) => void;
  /** 发送消息 */
  sendMessage: () => void;
  /** 是否正在流式响应 */
  isLoading: boolean;
}

/** AI SDK v6 流 chunk 类型 */
interface AISDKChunk {
  type: string;
  textDelta?: string;
  agentName?: string;
  agentId?: string;
  summary?: string;
}

/**
 * 团队聊天 hook — 通过 AI SDK UIMessageStream 流式请求。
 *
 * @param options - 配置选项
 * @returns 聊天状态和方法
 */
export function useTeamChat({ teamId, initialMessages = [] }: UseTeamChatOptions): UseTeamChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(() => {
    if (!input.trim() || isLoading || !teamId) return;

    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setIsLoading(true);

    let fullResponse = '';

    streamTeamChat(
      { teamId, message: input },
      (chunk: AISDKChunk) => {
        if (chunk.type === 'text-delta' && chunk.textDelta) {
          fullResponse += chunk.textDelta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { role: 'assistant', content: fullResponse }];
            }
            return [...prev, { role: 'assistant', content: fullResponse }];
          });
        }
      },
      (err) => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `错误: ${err.message}` },
        ]);
        setIsLoading(false);
      },
      () => setIsLoading(false),
    );

    setInput('');
  }, [input, isLoading, teamId]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  return {
    messages,
    input,
    handleInputChange,
    sendMessage,
    isLoading,
  };
}
