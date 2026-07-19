import {Hono} from 'hono';
import {createUIMessageStreamResponse, toUIMessageStream, UIMessage} from 'ai';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';

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

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const lastUserMessage = extractLastUserMessage(body);
    const requestedThreadId: string | undefined = body.threadId as string;

    // 前端本地临时 ID（如 __LOCALID_xxx）替换为真实 UUID
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;
    const threadId = isLocalThreadId ? crypto.randomUUID() : requestedThreadId;

    // 仅用于入参校验：有文本或有审批响应才是有效请求（提取/恢复由 agent 内部完成）
    if (!agentId || !requestedThreadId) {
      return c.json({ error: 'agentId, message and threadId are required' }, 400);
    }

    const output = await executeAgentChat({
      agentId,
      // 原生 UIMessage[] 直接下传：审批 part 由 agent 内部提取剥离，paused turn 自动恢复
      message: [lastUserMessage!],
      threadId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: output.stream }),
      headers: {
        threadId: threadId
      }
    });
  });
}
