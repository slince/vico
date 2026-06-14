import {v4 as uuidv4} from 'uuid';
import {RequestContext} from '@mastra/core/request-context';
import {mastra} from '../mastra.js';
import {createSSEStream} from '../agent/sse-utils.js';
import {getMemory} from '../agent/memory-setup.js';
import {prepareAgentContext, prepareMainAgentContext} from '../agent/agent.factory.js';
import type {MastraModelOutput} from '@mastra/core/stream';
import logger from '../lib/logger.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId?: string;
  tenantId: string;
  userId: string;
}

/**
 * 执行单 Agent 对话。
 *
 * agentId === 'main' 时自动解析为默认 Agent（is_default=1），使用 mainAgent 调度器；
 * 其他 agentId 直接查找对应记录，通过 agentProxy 模板注入运行时参数。
 * 通过 SSE 流式返回 AI 回复。
 */
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, message, threadId, tenantId, userId } = params;

  // 输入校验
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const thread = threadId || `${agentId}::${userId}::${uuidv4()}`;

    const requestContext = new RequestContext();


    // 1. 统一加载配置（agentId === 'main' 时内部自动解析为默认 Agent 并追加租户工具/能力描述）
    const ctx = agentId === 'main'
        ? await prepareMainAgentContext(tenantId, requestContext)
        : await prepareAgentContext(tenantId, agentId, requestContext);

    // 2. 统一保存 thread
    await saveThread(thread, tenantId, {
      agent_id: agentId,
      user_id: userId,
      model_name: ctx.agent.model_id,
    });

    // 3. 统一 streaming
    const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
    const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
      [{ role: 'user', content: message }],
      {
        instructions: ctx.instructions,
        memory: { thread, resource: tenantId },
        maxSteps: ctx.agent.max_steps || 10,
        requestContext,
      },
    );

    // 包装为 SSE 流，WorkingMemory + ObservationalMemory 由 Mastra processor pipeline 自动管理
    const stream = createSSEStream(output, {
      doneMetadata: { threadId: thread },
      onComplete: async () => {
        /* WorkingMemory + ObservationalMemory auto-managed by Mastra processor pipeline */
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An internal error occurred';
    logger.error({ err: error, agentId, tenantId }, 'Chat stream error');
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** 写入 thread 到 memory，避免重复的 saveThread 样板代码 */
async function saveThread(
  threadId: string,
  tenantId: string,
  metadata: Record<string, string>,
): Promise<void> {
  const memory = getMemory();
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId: tenantId,
      title: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
    },
  });
}
