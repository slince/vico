/**
 * Chat 执行引擎 — 纯 Vico 写法：createAgent 注册到 Runtime，vico.stream 执行。
 */
import type {AgentConfig, TurnOutput} from '@vico/agent';
import {agentManager} from '../services/agent/agent-manager.js';
import {vico} from '../vico.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
}

export interface ExecuteResumeParams {
  agentId: string;
  threadId: string;
  turnId: string;
  approvalDecisions: Array<{ toolCallId: string; approved: boolean }>;
  tenantId: string;
  userId: string;
}

/** 执行 Agent 对话 — 通过 vico.stream */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<TurnOutput> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) throw new Error('Message is required');

  // 确保 Agent 已在 Vico Runtime 注册（不存在则创建）
  const agent = await vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    const { agent: a, model } = runtimeConfig;
    return {
      id: a.id,
      name: a.name,
      systemPrompt: a.system_prompt,
      model: {
        provider: model.provider,
        model: model.model_name,
        baseUrl: model.base_url,
        apiKey: model.api_key,
      },
      temperature: a.temperature ?? 0.7,
      maxTokens: a.max_tokens ?? 4096,
      maxSteps: a.max_steps ?? 10,
    };
  });

  return agent.stream(message, {
    threadId,
    userId,
    scopeId: tenantId,
  });
}

/** 恢复已暂停的 turn */
export async function executeAgentResume(
  params: ExecuteResumeParams,
): Promise<TurnOutput> {
  const { agentId, threadId, turnId, approvalDecisions, tenantId, userId } = params;

  // 确保 Agent 已在 Vico Runtime 注册（不存在则创建）
  const agent = await vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    const { agent: a, model } = runtimeConfig;
    return {
      id: a.id,
      name: a.name,
      systemPrompt: a.system_prompt,
      model: {
        provider: model.provider,
        model: model.model_name,
        baseUrl: model.base_url,
        apiKey: model.api_key,
      },
      temperature: a.temperature ?? 0.7,
      maxTokens: a.max_tokens ?? 4096,
      maxSteps: a.max_steps ?? 10,
    };
  });

  return agent.resumeTurn({
    threadId,
    turnId,
    approvalDecisions,
    userId,
    scopeId: tenantId,
  });
}
