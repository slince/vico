import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { executeAgentChat, executeAgentResume } from '../chat/chat.js';
import { turnEventsToAISDK } from '@vico/agent';
import { vico } from '../vico.js';
import logger from '../lib/logger.js';

/** AI SDK transport message part 类型 */
interface AISDKMessagePart {
  type: string;
  text?: string;
  approvalId?: string;
  approved?: boolean;
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

/** 从消息 parts 中提取审批决策 */
function extractApprovalDecisions(
  body: Record<string, unknown>,
): Array<{ toolCallId: string; approved: boolean }> | undefined {
  const messages = body.messages as AISDKMessage[] | undefined;
  if (!messages?.length) return undefined;
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (!lastUserMsg) return undefined;
  const approvalParts = lastUserMsg.parts?.filter(p => p.type === 'tool-approval-response');
  if (!approvalParts?.length) return undefined;
  return approvalParts
    .filter(p => p.approvalId)
    .map(p => ({ toolCallId: p.approvalId!, approved: p.approved ?? false }));
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const message = extractMessage(body);
    const requestedThreadId: string | undefined = body.threadId as string;

    // 前端本地临时 ID（如 __LOCALID_xxx）替换为真实 UUID
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? crypto.randomUUID() : requestedThreadId;

    // 检测审批响应：若消息中仅含 tool-approval-response 而无文本，自动恢复暂停的 turn
    const approvalDecisions = message ? undefined : extractApprovalDecisions(body);

    if (approvalDecisions && approvalDecisions.length > 0 && agentId && threadId) {
      try {
        const agent = vico.runtime.getAgent(agentId);
        const pausedTurn = agent?.thread?.getLatestTurn
          ? await agent.thread.getLatestTurn(threadId)
          : undefined;

        if (pausedTurn && pausedTurn.status === 'paused') {
          const stream = await executeAgentResume({
            agentId,
            threadId,
            turnId: pausedTurn.id,
            approvalDecisions,
            tenantId: auth.tenantId,
            userId: auth.userId,
          });

          return turnEventsToAISDK(stream, {
            onFinish: (finish) => {
              finish.messageMetadata = { threadId };
            },
          });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'An internal error occurred';
        logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat auto-resume stream error');
        return c.json({ error: msg }, 500);
      }
    }

    if (!agentId || !message || !requestedThreadId) {
      return c.json({ error: 'agentId, message and threadId are required' }, 400);
    }

    try {
      const stream = await executeAgentChat({
        agentId,
        message,
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      return turnEventsToAISDK(stream, {
        onFinish: (finish) => {
          if (isLocalThreadId) {
            finish.messageMetadata = { threadId };
          }
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat stream error');
      return c.json({ error: msg }, 500);
    }
  });

  /** 恢复已暂停的 turn */
  app.post('/api/v1/chat/resume', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const threadId: string | undefined = body.threadId;
    const turnId: string | undefined = body.turnId;
    const approvalDecisions: Array<{ toolCallId: string; approved: boolean }> = body.approvalDecisions ?? [];

    if (!agentId || !threadId || !turnId) {
      return c.json({ error: 'agentId, threadId and turnId are required' }, 400);
    }

    try {
      const stream = await executeAgentResume({
        agentId,
        threadId,
        turnId,
        approvalDecisions,
        tenantId: auth.tenantId,
        userId: auth.userId,
      });

      return turnEventsToAISDK(stream, {
        onFinish: (finish) => {
          finish.messageMetadata = { threadId };
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat resume stream error');
      return c.json({ error: msg }, 500);
    }
  });
}
