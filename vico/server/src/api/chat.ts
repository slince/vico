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

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string | undefined = body.agentId;
    const lastUserMessage = extractLastUserMessage(body);
    const requestedThreadId: string = body.id as string;

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

    // 桥接 HTTP 请求生命周期到 agent 执行：客户端断开时自动终止 LLM 调用
    c.req.raw.signal.addEventListener('abort', () => output.abort(), { once: true });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: output.stream }),
      headers: {
        threadId: threadId
      }
    });
  });
}
