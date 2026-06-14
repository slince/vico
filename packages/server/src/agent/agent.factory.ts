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
 * 为 Agent 加载运行时配置并注入 requestContext。
 *
 * 同时处理 main（解析为默认 Agent）和自定义 Agent：
 * - agentId === 'main' 时从 is_default=1 的记录解析实际 ID
 * - 其他 agentId 直接使用
 *
 * 将 model 和 agentDetail 注入 requestContext 供 mastra Agent 读取。
 * 调用方捕获 AgentNotFoundError 后自行返回 400 错误响应。
 */
export async function prepareAgentContext(
  tenantId: string,
  agentId: string,
  requestContext: RequestContext,
): Promise<AgentRuntimeConfig> {
  // 解析实际的 Agent ID：main → 默认 Agent 的 ID
  let resolvedId: string;
  if (agentId === 'main') {
    const defaultAgent = await agentManager.getDefault(tenantId);
    if (!defaultAgent) {
      throw new AgentNotFoundError('Default agent not configured');
    }
    resolvedId = defaultAgent.id;
  } else {
    resolvedId = agentId;
  }

  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, resolvedId);
  if (!agentConfig) {
    throw new AgentNotFoundError('Agent not found');
  }

  requestContext.set('model', agentConfig.model);
  requestContext.set('agentDetail', agentConfig.agent);

  return agentConfig;
}
