/**
 * Agent Team Orchestrator — 多 Agent 协作编排引擎
 *
 * TODO: Migrate to Mastra agent.network()
 *
 * 当前为 Stub 实现。原编排器依赖已删除的 conversations/messages 表和 ai SDK 的 streamText/tool，
 * 后续将使用 Mastra 的 agent.network() 替代完整团队协作流程。
 * 此阶段仅保证编译通过，团队聊天端点返回功能不可用提示。
 */

import { getDb, schema } from '../db/db.js';
import { config } from '../config.js';
import { getDefaultModel, getModelById } from './model-registry.js';
import { resolveModelProvider } from './agent-factory.js';

/** 管道运行时上下文 */
export interface PipelineContext {
  tenantId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
}

/**
 * 解析 Agent 使用的模型。
 * 若 agent 指定了 model_id，使用该模型；否则使用租户默认模型。
 */
export function resolveAgentModel(tenantId: string, modelId?: string) {
  let modelConfig = modelId ? getModelById(tenantId, modelId) : getDefaultModel(tenantId);
  if (!modelConfig) {
    throw new Error('No LLM model configured. Please add a model in Settings first.');
  }
  return {
    model: resolveModelProvider(modelConfig),
    modelConfig,
  };
}

/**
 * 执行团队聊天管道。
 *
 * TODO: Migrate to Mastra agent.network()
 *
 * @returns SSE 错误流，告知前端团队聊天功能暂不可用
 */
export async function runTeamPipeline(
  teamId: string,
  message: string,
  ctx: PipelineContext,
): Promise<{ stream: ReadableStream; metadata: { conversationId: string; teamId: string } }> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'error',
            message: 'Team chat is being migrated to Mastra agent.network(). This feature is temporarily unavailable.',
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      controller.close();
    },
  });

  return {
    stream,
    metadata: {
      conversationId: '',
      teamId,
    },
  };
}
