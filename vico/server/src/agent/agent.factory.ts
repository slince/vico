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
  requestContext.set('instructions', agentConfig.instructions);

  return agentConfig;
}

/**
 * 为主 Agent 加载租户级上下文：注入 model/agentDetail + 拼接专业 Agent 能力描述。
 *
 * 租户工具（子 Agent 路由用）改由 buildMainAgentTools 在运行时按需构建，
 * 不再通过 requestContext 传递。
 *
 * @returns 含 instructions 的 AgentRuntimeConfig
 */
export async function prepareMainAgentContext(
  tenantId: string,
  requestContext: RequestContext,
): Promise<AgentRuntimeConfig> {

  const agentConfig = await prepareAgentContext(tenantId, 'main', requestContext)

  const agentDescriptions = await agentToolStore.getAgentDescriptions(tenantId);
  const instructions = agentConfig.instructions + agentDescriptions ? `\n\n## 当前可用的专业 Agent\n\n${agentDescriptions}` : '';
  requestContext.set('instructions', instructions);

  return agentConfig;
}
