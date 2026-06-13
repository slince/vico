// Mastra processors: 消息持久化 → messages 表
// input processor: 请求进入时记录用户消息
// output processor: 流完成时记录助手回复

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { messages } = schema;

interface MessagePersisterOptions {
  conversationId: string;
}

/** 创建消息持久化 processor pair（input + output） */
export function createMessagePersister(opts: MessagePersisterOptions) {
  let userMessage = '';

  const inputProcessor = {
    id: 'message-persister-input' as const,
    async processInput(args: any) {
      const msgs = args?.messages || [];
      const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
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
        } catch { /* non-critical */ }
      }
      return args;
    },
  } as any;

  const outputProcessor = {
    id: 'message-persister-output' as const,
    async processOutputResult(args: any) {
      const text = args?.text || '';
      if (text) {
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'assistant',
            content: text,
            created_at: Date.now(),
          }).run();
        } catch { /* non-critical */ }
      }
      return args;
    },
  } as any;

  return { inputProcessor, outputProcessor };
}
