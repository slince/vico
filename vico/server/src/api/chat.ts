import {Hono} from 'hono';
import {createUIMessageStreamResponse, toUIMessageStream, UIMessage} from 'ai';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {executeAgentChat} from '../chat/chat.js';

/** 从请求体提取最后一条 UIMessage */
function extractLastMessage(body: Record<string, unknown>): UIMessage | undefined {
  const messages = body.messages as UIMessage[] | undefined;
  if (!messages?.length) return undefined;
  return messages[messages.length - 1];
}

export function chatRoutes(app: Hono<{ Variables: Variables }>) {
  /** 单 Agent 对话（含审批响应自动恢复） */
  app.post('/api/v1/chat', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const body = await c.req.json();
    const agentId: string = body.agentId as string;
    const lastMessage = extractLastMessage(body);
    const requestedThreadId = body.threadId as string | undefined;

    // 前端本地临时 ID（如 __LOCALID_xxx）视为无真实线程，交由服务端新建
    const isLocalThreadId = requestedThreadId?.startsWith('__LOCALID_') ?? false;

    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }

    // 解析线程：有真实 threadId 则查库复用，无（或本地临时 ID）则新建
    const { output, thread } = await executeAgentChat({
      agentId,
      message: lastMessage,
      threadId: isLocalThreadId ? undefined : requestedThreadId,
      userId: auth.userId,
    });

    // 桥接 HTTP 请求生命周期到 agent 执行：客户端断开时自动终止 LLM 调用
    c.req.raw.signal.addEventListener('abort', () => output.abort(), { once: true });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: output.stream }),
      headers: {
        'x-thread-id': thread.id
      }
    });
  });
}
