import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { executeAgentChat } from '../chat/chat.js';
import { turnEventsToAISDK } from '@vico/agent';
import logger from '../lib/logger.js';

/** AI SDK transport message part 类型 */
interface AISDKMessagePart {
  type: string;
  text?: string;
}

/** AI SDK transport message 类型 */
interface AISDKMessage {
  role: string;
  parts: AISDKMessagePart[];
}

function extractMessage(body: Record<string, unknown>): string | undefined {
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  const messages = body.messages as AISDKMessage[] | undefined;
  if (!messages?.length) return undefined;
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  return lastUserMsg?.parts?.find(p => p.type === 'text')?.text;
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const message = extractMessage(body);
    const threadId: string | undefined = body.threadId as string;

    if (!agentId || !message || !threadId) {
      return c.json({ error: 'agentId, message and threadId are required' }, 400);
    }

    try {
      const { stream } = await executeAgentChat({
        agentId,
        message,
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      return turnEventsToAISDK(stream);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat stream error');
      return c.json({ error: msg }, 500);
    }
  });
}
