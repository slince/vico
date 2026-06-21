/**
 * AgentToolsFactory — 为 Agent 构建运行时工具集。
 *
 * 聚合 Skill 工具和 RAG 搜索工具。
 * 不再使用 Mastra createTool() 和 RequestContext。
 */
import { getSkillTools } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { agentToolStore } from './tools/agent-tool-store.js';
import type { Tool } from '@vico/agent';
import type { AgentDetail } from '../services/agent/types.js';

/**
 * 为指定 Agent 构建完整的运行时工具集。
 */
export async function buildAgentTools(
  agent: AgentDetail,
  tenantId: string,
  userId: string,
): Promise<Tool[]> {
  const tools: Tool[] = [];

  // Skill 工具
  const skillTools = await getSkillTools(agent.id, {
    tenantId,
    agentId: agent.id,
    userId,
    skillConfig: {},
  });
  tools.push(...skillTools);

  // RAG 搜索工具
  if (agent.rag_mode !== 'disabled') {
    const ragTool = await createRagSearchTool(agent);
    if (ragTool) tools.push(ragTool as unknown as Tool);
  }

  return tools;
}

/**
 * 为主 Agent 构建运行时工具集（含子 Agent 委托工具）。
 */
export async function buildMainAgentTools(
  agent: AgentDetail,
  tenantId: string,
  userId: string,
): Promise<Tool[]> {
  const [agentTools, tenantTools] = await Promise.all([
    buildAgentTools(agent, tenantId, userId),
    agentToolStore.getToolsForTenant(tenantId),
  ]);
  return [...Object.values(tenantTools), ...agentTools];
}
