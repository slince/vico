import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';
import { getMemory } from '../agent/memory-setup.js';

const { agents } = schema;

/**
 * 从 Mastra 消息中提取纯文本内容。
 * MastraDBMessage.content 是 MastraMessageContentV2 格式 { format: 2, parts, content? }。
 */
function extractMessageText(msg: any): string {
  try {
    if (typeof msg.content === 'string') return msg.content;
    const c = msg.content;
    // 优先用顶层 content 字符串
    if (c?.content && typeof c.content === 'string') return c.content;
    // 从 parts 中提取 text 类型
    if (c?.parts && Array.isArray(c.parts)) {
      const texts = c.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('');
      if (texts) return texts;
    }
    // 兜底：序列化整个 content
    return JSON.stringify(c);
  } catch {
    return '';
  }
}

/**
 * 从 Mastra 消息中提取工具调用信息。
 */
function extractToolCalls(msg: any): string | undefined {
  try {
    const c = msg.content;
    if (c?.parts && Array.isArray(c.parts)) {
      const toolParts = c.parts.filter((p: any) =>
        p.type === 'tool-invocation' || p.type === 'tool-call',
      );
      if (toolParts.length > 0) {
        return JSON.stringify(
          toolParts.map((p: any) => ({
            name: p.toolName ?? p.tool?.name,
            arguments: p.args ?? p.tool?.args ?? {},
            result: p.result ?? p.tool?.result,
          })),
        );
      }
    }
  } catch {}
  return undefined;
}

/** Mastra thread 的核心字段 */
interface MastraThread {
  id: string;
  title?: string;
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * 将 Mastra thread 映射为前端期望的 conversation 格式。
 */
async function threadToConversation(thread: MastraThread) {
  const meta = (thread.metadata || {}) as Record<string, unknown>;
  const db = getDb();

  let agentName: string | undefined;
  const agentId = meta.agent_id as string | undefined;
  if (agentId) {
    const agent = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    agentName = agent?.name;
  }

  return {
    id: thread.id,
    tenant_id: thread.resourceId,
    agent_id: agentId || '',
    user_id: (meta.user_id as string) || '',
    title: thread.title || '',
    model_name: (meta.model_name as string) || '',
    message_count: 0, // 需要单独查询消息数
    total_tokens: 0,
    created_at: new Date(thread.createdAt).getTime(),
    updated_at: new Date(thread.updatedAt).getTime(),
    agent_name: agentName,
  };
}

export function conversationRoutes(app: Hono<{ Variables: Variables }>) {
  /** 对话列表 — 从 Mastra threads 读取，支持搜索和按 Agent 过滤 */
  app.get('/api/v1/conversations', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const search = c.req.query('search')?.toLowerCase();
    const agentIdFilter = c.req.query('agent_id');

    const memory = getMemory();

    // 从 Mastra 获取该 resource（=tenant）下的所有 thread
    const result = await memory.listThreads({
      perPage: false,
      filter: { resourceId: auth.tenantId },
    });

    // 映射为前端格式
    let convs = [];
    for (const thread of result.threads) {
      const conv = await threadToConversation(thread);

      // 如果指定了 agent 过滤，在映射阶段过滤
      if (agentIdFilter && conv.agent_id !== agentIdFilter) continue;

      // 获取消息数（只取 1 条以减少数据传输）
      try {
        const msgResult = await memory.recall({ threadId: thread.id, perPage: 1 });
        conv.message_count = msgResult.total;
      } catch {
        conv.message_count = 0;
      }

      convs.push(conv);
    }

    // 搜索过滤在内存中进行
    if (search) {
      convs = convs.filter(
        (conv) =>
          conv.title.toLowerCase().includes(search) ||
          (conv.agent_name || '').toLowerCase().includes(search),
      );
    }

    // 按 updated_at 降序
    convs.sort((a, b) => b.updated_at - a.updated_at);

    return c.json(convs);
  });

  /** 对话详情 — 包含消息列表 */
  app.get('/api/v1/conversations/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const id = c.req.param('id');
    const memory = getMemory();

    const thread = await memory.getThreadById({ threadId: id });
    if (!thread) return c.json({ error: 'Conversation not found' }, 404);

    // 校验 resource（tenant）归属
    if (thread.resourceId !== auth.tenantId) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    const conv = await threadToConversation(thread);

    // 获取消息列表
    let messages: any[] = [];
    try {
      const msgResult = await memory.recall({ threadId: id, perPage: false });
      conv.message_count = msgResult.total;

      messages = msgResult.messages.map((msg: any) => {
        // Mastra role 映射：tool/signal → system 以便前端显示
        const role = ['user', 'assistant', 'system'].includes(msg.role)
          ? msg.role
          : 'system';
        return {
          id: msg.id,
          conversation_id: msg.thread_id || id,
          role,
          content: extractMessageText(msg),
          tool_calls: extractToolCalls(msg),
          token_usage: 0,
          created_at: new Date(msg.createdAt).getTime(),
        };
      });
    } catch {
      conv.message_count = 0;
    }

    return c.json({
      ...conv,
      messages,
    });
  });
}
