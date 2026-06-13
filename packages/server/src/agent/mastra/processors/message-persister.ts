// AI SDK v4 兼容的消息持久化 Processor
// input: 记录用户消息 → messages 表
// output: 记录助手回复 → messages 表

import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../../db/db.js';

const { messages } = schema;

interface MessagePersisterOptions {
  conversationId: string;
  tenantId: string;
  userId: string;
}

/** 创建消息持久化 processor pair（input + output） */
export function createMessagePersister(opts: MessagePersisterOptions) {
  const inputProcessor = {
    id: 'message-persister-input' as const,
    async processInput(args: any) {
      const msgs = args?.messages || [];
      const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
      if (lastUser) {
        try {
          const db = getDb();
          db.insert(messages).values({
            id: uuid(),
            conversation_id: opts.conversationId,
            role: 'user',
            content: typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content),
            created_at: Date.now(),
          }).run();
        } catch { /* non-critical */ }
      }
      return args;
    },
  };

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
  };

  return { inputProcessor, outputProcessor };
}
