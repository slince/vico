import {Hono} from 'hono';
import {createUIMessageStreamResponse, toUIMessageStream, UIMessage} from 'ai';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';
import {type ToolApproval, turnOutputToSSEResponse} from '@vico/agent';
import logger from '../lib/logger.js';

/** 从请求体提取最后一条 user UIMessage */
function extractLastUserMessage(body: Record<string, unknown>): UIMessage | undefined {
  const messages = body.messages as UIMessage[] | undefined;
  if (!messages?.length) return undefined;
  return messages.filter((m) => m.role === 'user').pop();
}

/** 提取消息文本（判断本次请求是否携带用户输入） */
function extractText(msg: UIMessage | undefined): string {
  if (!msg) return '';
  return msg.parts
    .filter((p): p is Extract<UIMessage['parts'][number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** 从消息 parts 中提取审批决策（tool-approval-response 为客户端扩展 part） */
function extractApprovalDecisions(msg: UIMessage | undefined): ToolApproval[] | undefined {
  if (!msg) return undefined;
  const approvalParts = (msg.parts as Array<{ type: string; approvalId?: string; approved?: boolean }>)
    .filter((p) => p.type === 'tool-approval-response' && p.approvalId);
  if (!approvalParts.length) return undefined;
  return approvalParts.map((p) => ({ toolCallId: p.approvalId!, approved: p.approved ?? false }));
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const lastUserMessage = extractLastUserMessage(body);
    const messageText = extractText(lastUserMessage);
    const requestedThreadId: string | undefined = body.threadId as string;

    // 前端本地临时 ID（如 __LOCALID_xxx）替换为真实 UUID
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? crypto.randomUUID() : requestedThreadId;

    // 提取审批决策（若消息中仅含 tool-approval-response 无文本，agent loop 自动恢复 paused turn）
    const approvalDecisions = messageText ? undefined : extractApprovalDecisions(lastUserMessage);

    if (!agentId || (!messageText && !approvalDecisions?.length) || !requestedThreadId) {
      return c.json({ error: 'agentId, message and threadId are required' }, 400);
    }

    const output = await executeAgentChat({
      agentId,
      // 原生 UIMessage[] 直接下传（agent 内部 convertToModelMessages）
      message: lastUserMessage && messageText ? [lastUserMessage] : '',
      threadId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      approvalDecisions,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: output.stream }),
      headers: {
        threadId: threadId
      }
    });
  });

  /** 恢复已暂停的 turn（委托给 executeAgentChat，agent loop 自动检测 paused turn） */
  app.post('/api/v1/chat/resume', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const threadId: string | undefined = body.threadId;
    const approvalDecisions: ToolApproval[] = body.approvalDecisions ?? [];

    if (!agentId || !threadId) {
      return c.json({ error: 'agentId and threadId are required' }, 400);
    }

    try {
      const stream = await executeAgentChat({
        agentId,
        message: '',
        threadId,
        tenantId: auth.tenantId,
        userId: auth.userId,
        approvalDecisions,
      });

      return turnOutputToSSEResponse(stream, {
        onFinish: (finish) => {
          finish.messageMetadata = { ...(finish.messageMetadata as any), threadId };
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'An internal error occurred';
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat resume stream error');
      return c.json({ error: msg }, 500);
    }
  });
}
