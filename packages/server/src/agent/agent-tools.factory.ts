/**
 * AgentToolsFactory — 为 Agent 构建运行时工具集。
 *
 * 聚合 Skill 工具和 RAG 搜索工具，
 * 由调用方将结果注入 requestContext，供 agentProxy 的 tools 函数同步读取。
 */
import {getSkillToolsForMastraAgent} from './tools/skill-tool-adapter';
import {createRagSearchTool} from './tools/rag-tool';
import {agentToolStore} from './tools/agent-tool-store.js';
import {AgentDetail} from '../services/agent/types.js';
import {Tool} from "@mastra/core/tools";

/**
 * 为指定 Agent 构建完整的运行时工具集。
 *
 * 按顺序聚合两类工具：
 * 1. Skill 工具 — 来自 Agent 绑定的 Skill 插件的工具导出
 * 2. RAG 工具 — 仅当 agent.rag_mode !== 'disabled' 时启用
 *
 * @param agent - Agent 详情（含 skills、rag_mode 及 tenant_id）
 * @returns 工具集，key 为工具 ID
 */
export async function buildAgentTools(
  agent: AgentDetail,
): Promise<Record<string, Tool>> {
  const { id, tenant_id, rag_mode } = agent;
  const tools: Record<string, Tool> = {};

  // 1. Skill 工具
  const skillTools = await getSkillToolsForMastraAgent(id, {
    tenantId: tenant_id,
    agentId: id,
    userId: '',
    skillConfig: {},
  });
  Object.assign(tools, skillTools);

  // 2. RAG 搜索工具
  if (rag_mode !== 'disabled') {
    const ragTool = await createRagSearchTool(agent);
    if (ragTool) {
      tools[ragTool.id] = ragTool;
    }
  }

  return tools;
}

/**
 * 为主 Agent 构建运行时工具集。
 *
 * 聚合两类工具：
 * 1. Agent 工具 — 来自该 Agent 绑定的 Skill、RAG 等
 * 2. 租户工具 — 来自该租户下其他 Agent 注册的工具（用于子 Agent 路由）
 *
 * @param agent - Agent 详情（含 tenant_id）
 * @returns 工具集，key 为工具 ID
 */
export async function buildMainAgentTools(
  agent: AgentDetail,
): Promise<Record<string, Tool>> {
  const [agentTools, tenantTools] = await Promise.all([
    buildAgentTools(agent),
    agentToolStore.getToolsForTenant(agent.tenant_id),
  ]);
  return { ...tenantTools, ...agentTools };
}
