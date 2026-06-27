/**
 * Chat 执行引擎 — 纯 Vico 写法：createAgent 注册到 Runtime，vico.stream 执行。
 */
import type {Agent, TurnOutput} from '@vico/agent';
import {agentManager} from '../services/agent/agent-manager.js';
import {vico} from '../vico.js';
import type {AgentRuntimeConfig} from "../services/agent/types";

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
}

export interface ExecuteChatResult {
  stream: TurnOutput;
}

/** 执行 Agent 对话 — 通过 vico.stream */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatResult> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) throw new Error('Message is required');

  // 确保 Agent 已在 Vico Runtime 注册
  if (!vico.runtime.getAgent(agentId)) {
    const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!agentConfig) throw new Error('Agent not found');
    await createAgent(agentConfig);
  }

  const stream = vico.stream(agentId, message, {
    threadId,
    userId,
    scopeId: tenantId,
  });

  return { stream };
}

async function createAgent(runtimeConfig: AgentRuntimeConfig): Promise<Agent> {
  const { agent, model } = runtimeConfig;

  return vico.createAgent({
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.system_prompt || '',
    model: {
      provider: model.provider,
      model: model.model_name,
      baseUrl: model.base_url || undefined,
      apiKey: model.api_key || undefined,
    },
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.max_tokens ?? 4096,
    maxSteps: agent.max_steps ?? 10,
    skills: { load: async () => [] },
    thread: vico.thread,
  });
}