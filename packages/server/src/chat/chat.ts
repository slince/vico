import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../mastra.js';
import { createSSEStream } from '../agent/sse-utils.js';
import { getMemory } from '../agent/memory-setup.js';
import { prepareAgentContext, AgentNotFoundError } from '../agent/agent.factory.js';
import { workingMemory } from '../agent/memory/working-memory.js';
import type { AgentRuntimeConfig } from '../services/agent/types.js';
import type { MastraModelOutput } from '@mastra/core/stream';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { LanguageModel } from 'ai';
import logger from '../lib/logger.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  conversationId?: string;
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
  const { agentId, message, conversationId, tenantId, userId } = params;

  // 输入校验
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const cid = conversationId || uuidv4();
    // 使用 :: 分隔符避免 UUID 中的 - 造成 thread ID 歧义
    const threadId = `${agentId}::${userId}::${cid}`;

    const requestContext = new RequestContext();

    // 追踪实际使用的模型，供 onComplete 中 working memory 提取使用
    let activeModel: MastraModelConfig | null = null;

    // 1. 统一加载配置（agentId === 'main' 时内部自动解析为默认 Agent 并追加租户工具/能力描述）
    let ctx: AgentRuntimeConfig;
    try {
      ctx = await prepareAgentContext(tenantId, agentId, requestContext);
      activeModel = ctx.model;
    } catch (error: unknown) {
      if (error instanceof AgentNotFoundError) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }

    // 2. 统一保存 thread
    await saveThread(threadId, tenantId, {
      agent_id: agentId,
      user_id: userId,
      model_name: ctx.agent.model_id || '',
    });

    // 3. 统一 streaming
    const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
    const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
      [{ role: 'user', content: message }],
      {
        instructions: ctx.instructions,
        memory: { thread: threadId, resource: tenantId },
        maxSteps: ctx.agent.max_steps || 10,
        requestContext,
      },
    );

    // 包装为 SSE 流，流结束后异步提取工作记忆
    const stream = createSSEStream(output, {
      onComplete: async (fullText: string) => {
        if (!activeModel) return;
        // MastraModelConfig 兼容 AI SDK LanguageModel（LanguageModelV1/V2/V3 联合类型）
        await workingMemory.extractAndStore(
          activeModel as unknown as LanguageModel,
          tenantId,
          userId,
          [
            { role: 'user', content: message },
            { role: 'assistant', content: fullText },
          ],
        );
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
