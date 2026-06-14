import { useState, useCallback } from 'react';
import { streamChat } from '@/api/client';
import type { ChatMessage } from '@/pages/agent-detail/types';

/** useAgentChat 的配置选项 */
export interface UseAgentChatOptions {
  /** 当前 Agent ID */
  agentId: string;
  /** 可选：初始消息列表 */
  initialMessages?: ChatMessage[];
}

/** useAgentChat 的返回值 */
export interface UseAgentChatReturn {
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
 * Agent 聊天 hook — 封装 SSE 流式请求和消息状态管理
 *
 * 替代手动调用 streamChat + 管理 SSE 事件的模式，
 * 提供与组件解耦的聊天状态管理。
 *
 * @param options - 配置选项
 * @returns 聊天状态和方法
 */
export function useAgentChat({ agentId, initialMessages = [] }: UseAgentChatOptions): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(() => {
    if (!input.trim() || isLoading || !agentId) return;

    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setIsLoading(true);

    let fullResponse = '';

    streamChat(
      { agentId, message: input },
      (event) => {
        if (event.type === 'text_delta') {
          fullResponse += event.content;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { role: 'assistant', content: fullResponse },
              ];
            }
            return [...prev, { role: 'assistant', content: fullResponse }];
          });
        } else if (event.type === 'approval_required') {
          // 追加审批请求到当前助手消息末尾，方便 ChatPanel 渲染审批卡片
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: last.content + `\n\n[Exec Approval Required: ${event.command}]\n`,
                  pendingApproval: { command: event.command },
                },
              ];
            }
            return [
              ...prev,
              {
                role: 'assistant' as const,
                content: `[Exec Approval Required: ${event.command}]\n`,
                pendingApproval: { command: event.command },
              },
            ];
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
  }, [input, isLoading, agentId]);

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
