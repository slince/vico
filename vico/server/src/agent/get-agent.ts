/**
 * Agent 实例获取 — 组合 DB 配置查询、AgentConfig 构建、Vico Runtime 注册。
 *
 * 服务端各处可通过 getAgent(id) 直接拿到可交互的 agent 对象。
 */
import type {AgentConfig} from '@vico/core';
import {agentManager} from '../services/agent/agent-manager.js';
import {vico} from '../vico.js';
import type {AgentRuntimeConfig} from "../services/agent/types";

/** 将 DB 运行时配置转换为 AgentConfig */
function buildAgentConfig(runtimeConfig: AgentRuntimeConfig): AgentConfig {
  const { agent: a, model, workspace } = runtimeConfig;
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
    workspace
  };
}

/**
 * 获取或注册 Vico Agent 实例（不存在则创建，全局缓存）。
 *
 * 组合 agentManager.getAgentRuntimeConfig → buildAgentConfig → vico.createIfAbsent，
 * 方便各层按 agentId 直接拿到可交互的 agent 对象。
 */
export async function getAgent(agentId: string) {
  return vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    return buildAgentConfig(runtimeConfig!);
  });
}
