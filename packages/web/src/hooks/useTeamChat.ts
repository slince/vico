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

/**
 * 团队聊天 hook — 封装 SSE 流式请求和消息状态管理
 *
 * 处理单 Agent 聊天和团队协作聊天的区别：
 * - delegation_start / delegation_end 事件展示委派状态
 * - text_delta 事件实时拼接助手回复
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
      (event) => {
        if (event.type === 'delegation_start') {
          setMessages((prev) => [
            ...prev,
            {
              role: 'delegation',
              content: `正在委派给 ${event.agentName || event.agentId}...`,
              agentName: event.agentName,
            },
          ]);
        } else if (event.type === 'delegation_end') {
          setMessages((prev) => [
            ...prev,
            {
              role: 'delegation',
              content: `委派结果: ${event.summary || ''}`,
              agentName: event.agentName,
            },
          ]);
        } else if (event.type === 'text_delta') {
          fullResponse += event.content;
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
