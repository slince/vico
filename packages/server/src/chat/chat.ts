import {RequestContext} from '@mastra/core/request-context';
import {mastra} from '../mastra.js';

import {getMemory} from '../agent/memory-setup.js';
import {prepareAgentContext, prepareMainAgentContext} from '../agent/agent.factory.js';
import type {MastraModelOutput} from '@mastra/core/stream';

import { resourceId } from '../lib/resource.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  /** 前端必传的对话线程 ID */
  threadId: string;
  tenantId: string;
  userId: string;
}

/** executeAgentChat 的返回值 */
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
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatRawResult> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) {
    throw new Error('Message is required');
  }

  const thread = threadId;
  const requestContext = new RequestContext();

  const ctx = agentId === 'main'
    ? await prepareMainAgentContext(tenantId, requestContext)
    : await prepareAgentContext(tenantId, agentId, requestContext);

  await saveThread(thread, tenantId, userId, {
    agent_id: agentId,
    user_id: userId,
    model_name: ctx.agent.model_id,
  }, message);

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

/** 提取消息前段作为对话标题（截取前 50 个字符，去除换行） */
function extractTitle(message: string): string {
  const cleaned = message.replace(/\n/g, ' ').trim();
  return cleaned.length > 50 ? cleaned.slice(0, 50) + '…' : cleaned;
}

/** 写入 thread 到 memory，首次创建时从消息内容提取标题 */
async function saveThread(
  threadId: string,
  tenantId: string,
  userId: string,
  metadata: Record<string, string>,
  message: string,
): Promise<void> {
  const memory = await getMemory();

  // 检查是否为新 thread，首次创建时提取标题
  const existing = await memory.getThreadById({ threadId });
  const title = existing ? existing.title || '' : extractTitle(message);

  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId: resourceId(tenantId, userId),
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
    },
  });
}
