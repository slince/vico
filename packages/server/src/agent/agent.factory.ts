import {RequestContext} from '@mastra/core/request-context';
import {agentManager} from '../services/agent/agent-manager.js';
import {agentToolStore} from './tools/agent-tool-store.js';
import type {AgentRuntimeConfig} from '../services/agent/types.js';

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
 * - agentId === 'main' 时从 is_default=1 的记录解析实际 ID，并追加租户 Agent 工具与能力描述
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

  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
  if (!agentConfig) {
    throw new AgentNotFoundError('Agent not found');
  }

  requestContext.set('model', agentConfig.model);
  requestContext.set('agentDetail', agentConfig.agent);

  return agentConfig;
}

/**
 * 为主 Agent 加载租户级上下文：Agent 代理工具 + 专业 Agent 能力描述。
 *
 * - 从 agentToolStore 获取租户下所有启用的 Agent 工具，注入 requestContext
 * - 生成可用 Agent 的描述文本，拼接到系统提示词中
 *
 * @returns 要追加到 instructions 的能力描述文本
 */
export async function prepareMainAgentContext(
  tenantId: string,
  requestContext: RequestContext,
): Promise<AgentRuntimeConfig> {

  const agentConfig = await prepareAgentContext(tenantId, 'main', requestContext)

  const [tenantTools, agentDescriptions] = await Promise.all([
    agentToolStore.getToolsForTenant(tenantId),
    agentToolStore.getAgentDescriptions(tenantId),
  ]);
  if (Object.keys(tenantTools).length > 0) {
    requestContext.set('tenantTools', tenantTools);
  }

  agentDescriptions ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}` : '';

  return agentConfig;
}
