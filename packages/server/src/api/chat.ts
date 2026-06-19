import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { executeAgentChat } from '../chat/chat.js';
import { createAISDKStream, createNetworkAISDKStream } from '../agent/ai-sdk-stream.js';
import { createTeamNetwork } from '../agent/team-network.js';
import logger from '../lib/logger.js';

/** AI SDK transport 发送的 message part 类型 */
interface AISDKMessagePart {
  type: string;
  text?: string;
}

/** AI SDK transport 发送的 message 类型 */
interface AISDKMessage {
  role: string;
  parts: AISDKMessagePart[];
}

/**
 * 从 AI SDK transport 请求体中提取消息文本。
 * AI SDK 发送 messages 数组（格式: [{ role, parts: [{ type, text }] }]），
 * 兼容旧格式 { message: string }。
 */
function extractMessage(body: Record<string, unknown>): string | undefined {
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  const messages = body.messages as AISDKMessage[] | undefined;
  if (!messages?.length) return undefined;
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  return lastUserMsg?.parts?.find(p => p.type === 'text')?.text;
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话 — AI SDK 协议 */
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
      const { thread, output } = await executeAgentChat({
        agentId,
        message,
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      return createAISDKStream(output, {
        doneMetadata: { threadId: thread },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat AI SDK stream error');
      return c.json({ error: msg }, 500);
    }
  });

  /** 团队对话 — AI SDK 协议 */
  app.post('/api/v1/teams/:id/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const teamId = c.req.param('id');
    const body = await c.req.json();
    const message = extractMessage(body);
    if (!message) return c.json({ error: 'message is required' }, 400);

    try {
      const { stream } = await createTeamNetwork(teamId, message, {
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      return createNetworkAISDKStream(stream);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, teamId }, 'Team chat AI SDK stream error');
      return c.json({ error: msg }, 500);
    }
  });
}
