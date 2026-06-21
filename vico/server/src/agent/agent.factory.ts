/**
 * Agent 工厂 — 加载 Agent 运行时配置。
 *
 * 不再使用 Mastra RequestContext。改为直接返回配置对象。
 */
import { agentManager } from '../services/agent/agent-manager.js';
import type { AgentRuntimeConfig } from '../services/agent/types.js';

export class AgentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * 加载 Agent 运行时配置。
 *
 * @returns 含 model/instructions/agent 详情的运行时配置
 */
export async function resolveAgentConfig(
  tenantId: string,
  agentId: string,
): Promise<AgentRuntimeConfig> {
  const config = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
  if (!config) throw new AgentNotFoundError('Agent not found');
  return config;
}
