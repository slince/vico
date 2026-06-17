import {v4 as uuidv4} from 'uuid';
import {RequestContext} from '@mastra/core/request-context';
import {mastra} from '../mastra.js';
import {createSSEStream} from '../agent/sse-utils.js';
import {getMemory} from '../agent/memory-setup.js';
import {prepareAgentContext, prepareMainAgentContext} from '../agent/agent.factory.js';
import type {MastraModelOutput} from '@mastra/core/stream';
import logger from '../lib/logger.js';
import { resourceId } from '../lib/resource.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId?: string;
  tenantId: string;
  userId: string;
}

/** executeAgentChatRaw 的返回值 */
export interface ExecuteChatRawResult {
  thread: string;
  output: MastraModelOutput<unknown>;
}

/**
 * 执行单 Agent 对话的公共逻辑。
 *
 * 加载 Agent 配置、保存 thread、调用 Mastra agent.stream()，
 * 返回 raw MastraModelOutput + threadId，由调用方决定如何格式化（SSE 或 AI SDK）。
 */
export async function executeAgentChatRaw(
  params: ExecuteChatParams,
): Promise<ExecuteChatRawResult> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) {
    throw new Error('Message is required');
  }

  const thread = threadId || `${agentId}::${userId}::${uuidv4()}`;
  const requestContext = new RequestContext();

  const ctx = agentId === 'main'
    ? await prepareMainAgentContext(tenantId, requestContext)
    : await prepareAgentContext(tenantId, agentId, requestContext);

  await saveThread(thread, tenantId, userId, {
    agent_id: agentId,
    user_id: userId,
    model_name: ctx.agent.model_id,
  });

  const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
  const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
    [{ role: 'user', content: message }],
    {
      instructions: ctx.instructions,
      memory: { thread, resource: resourceId(tenantId, userId) },
      maxSteps: ctx.agent.max_steps || 10,
      requestContext,
    },
  );

  return { thread, output };
}

/**
 * 执行单 Agent 对话。
 *
 * agentId === 'main' 时自动解析为默认 Agent（is_default=1），使用 mainAgent 调度器；
 * 其他 agentId 直接查找对应记录，通过 agentProxy 模板注入运行时参数。
 * 通过 SSE 流式返回 AI 回复。
 */
export async function executeAgentChat(params: ExecuteChatParams): Promise<Response> {
  const { agentId, tenantId } = params;

  // 输入校验
  if (!params.message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { thread, output } = await executeAgentChatRaw(params);

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

/** 写入 thread 到 memory，resourceId = tenantId:userId 实现用户级隔离 */
async function saveThread(
  threadId: string,
  tenantId: string,
  userId: string,
  metadata: Record<string, string>,
): Promise<void> {
  const memory = await getMemory();
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId: resourceId(tenantId, userId),
      title: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
    },
  });
}
