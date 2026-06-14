/**
 * AgentToolsFactory — 为 Agent 构建运行时工具集。
 *
 * 聚合 Skill 工具、RAG 搜索工具和 per-agent 内置工具，
 * 由调用方将结果注入 requestContext，供 agentProxy 的 tools 函数同步读取。
 */
import { getSkillToolsForMastraAgent } from './skill-tool-adapter';
import { createRagSearchTool } from './rag-tool';
import { builtinToolManager } from './builtin';
import { AgentDetail } from '../../services/agent/types.js';
import {Tool} from "@mastra/core/tools";

/**
 * 为指定 Agent 构建完整的运行时工具集。
 *
 * 按顺序聚合三类工具：
 * 1. Skill 工具 — 来自 Agent 绑定的 Skill 插件的工具导出
 * 2. RAG 工具 — 仅当 agent.rag_mode !== 'disabled' 时启用
 * 3. 内置工具 — 来自 agent.builtin_tools 配置（read/write/edit/ls/grep/stat/exec）
 *
 * @param agent - Agent 详情（含 skills、rag_mode、builtin_tools 及 tenant_id）
 * @returns 工具集，key 为工具 ID
 */
export async function buildAgentTools(
  agent: AgentDetail,
): Promise<Record<string, Tool>> {
  const { id, tenant_id, rag_mode, builtin_tools } = agent;
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

  // 3. Per-agent 内置工具
  const builtinTools = await builtinToolManager.getToolsForAgent(
    { builtin_tools: builtin_tools ?? '{}' },
    tenant_id,
  );
  Object.assign(tools, builtinTools);

  return tools;
}
