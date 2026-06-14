import { RequestContext } from '@mastra/core/request-context';
import { agentManager } from '../services/agent/agent-manager.js';
import type { AgentRuntimeConfig } from '../services/agent/types.js';

export class AgentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * 为自定义 Agent 加载运行时配置并注入 requestContext。
 *
 * 校验 Agent 存在性 → 获取运行时配置（模型、instructions、agent 详情）→
 * 将 model 和 agentDetail 注入 requestContext 供 agentProxy 使用。
 *
 * 调用方捕获 AgentNotFoundError 后自行返回 400 错误响应。
 */
export async function prepareAgentContext(
  tenantId: string,
  agentId: string,
  requestContext: RequestContext,
): Promise<AgentRuntimeConfig> {
  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
  if (!agentConfig) {
    throw new AgentNotFoundError('Agent not found');
  }

  requestContext.set('model', agentConfig.model);
  requestContext.set('agentDetail', agentConfig.agent);

  return agentConfig;
}
