// Mastra input/output processor: 消息持久化 → messages 表
// input processor: 在请求进入时记录用户消息
// output processor: 在流完成时记录助手回复

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { messages } = schema;

interface MessagePersisterOptions {
  conversationId: string;
}

/**
 * 创建消息持久化 processor pair（input + output）。
 * input processor 在请求进入时持久化用户消息。
 * output processor 在流完成后持久化助手回复。
 */
export function createMessagePersister(opts: MessagePersisterOptions) {
  let userMessage = '';

  const inputProcessor = {
    type: 'input' as const,
    name: 'message-persister-input',
    async process(args: { messages?: Array<{ role: string; content: string }> }) {
      const msgs = args?.messages || [];
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        userMessage = lastUser.content;
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'user',
            content: userMessage,
            created_at: Date.now(),
          }).run();
        } catch {
          // 消息持久化失败不阻塞主流程
        }
      }
      return args;
    },
  };

  const outputProcessor = {
    type: 'output' as const,
    name: 'message-persister-output',
    async process(args: { result: any; text?: string }) {
      const assistantText = args?.text || '';
      if (assistantText) {
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'assistant',
            content: assistantText,
            created_at: Date.now(),
          }).run();
        } catch {
          // 消息持久化失败不阻塞主流程
        }
      }
      return args;
    },
  };

  return { inputProcessor, outputProcessor };
}
