/**
 * Mastra 团队编排 — 基于 agent.network() 的多 Agent 协作
 *
 * 替代原有的 runTeamPipeline 半成品实现，使用 Mastra 原生多 Agent 网络：
 * 1. 从数据库加载团队配置及成员列表
 * 2. 为每个成员创建 Mastra Agent 实例
 * 3. 创建 Supervisor Agent（路由 Agent），将成员作为 sub-agents 注入
 * 4. 调用 supervisor.network() 执行多 Agent 协作
 * 5. 返回 MastraAgentNetworkStream 供 SSE 包装
 */
import { Agent } from '@mastra/core/agent';
import type { MastraAgentNetworkStream } from '@mastra/core/stream';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/db.js';
import { resolveModelProvider } from './bridges/model-bridge.js';
import { modelManager } from '../services/model/model-manager.js';
import { skillManager } from '../skill/manager.js';
import { getSkillToolsForMastraAgent } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { agentManager } from '../services/agent/agent-manager.js';
import logger from '../lib/logger.js';

const { agentTeams, agentTeamMembers, agents } = schema;

interface TeamConfig {
  teamId: string;
  teamName: string;
  tenantId: string;
  supervisorAgentId: string | null;
  routingStrategy: string;
  members: { agentId: string; role: string }[];
}

/** 从数据库加载团队配置 */
async function loadTeamConfig(teamId: string, tenantId: string): Promise<TeamConfig> {
  const db = getDb();

  const team = await db.select().from(agentTeams)
    .where(and(eq(agentTeams.id, teamId), eq(agentTeams.tenant_id, tenantId)))
    .get();
  if (!team) throw new Error('Team not found');

  const members = await db.select({
    agentId: agentTeamMembers.agent_id,
    role: agentTeamMembers.role,
  }).from(agentTeamMembers)
    .where(eq(agentTeamMembers.team_id, teamId))
    .all();

  if (members.length === 0) throw new Error('Team has no members');

  return {
    teamId: team.id,
    teamName: team.name,
    tenantId,
    supervisorAgentId: team.supervisor_agent_id,
    routingStrategy: team.routing_strategy,
    members,
  };
}

/**
 * 从数据库配置构建 Mastra Agent 实例（团队子代理）。
 *
 * 直接从 agents 表查询配置，加载模型、Skill 提示词/工具和 RAG 工具，
 * 构建 Mastra Agent 对象。不使用 agent-factory 层的 createAgent。
 *
 * @param agentId - Agent ID
 * @param tenantId - 租户 ID
 * @param userId - 用户 ID
 * @returns Mastra Agent 实例
 */
async function createMemberAgent(
  agentId: string,
  tenantId: string,
  userId: string,
): Promise<Agent> {
  const agentRow = await agentManager.getById(tenantId, agentId);
  if (!agentRow) throw new Error(`Agent ${agentId} not found`);

  // 加载模型
  let model: ReturnType<typeof resolveModelProvider> | null = null;
  try {
    const modelConfig = await modelManager.getDefault(tenantId);
    if (modelConfig) {
      model = resolveModelProvider(modelConfig);
    }
  } catch {}

  // 构建 instructions：Agent prompt + Skill 提示词
  let instructions = agentRow.system_prompt || '';
  try {
    const skillPrompts = await skillManager.getPromptForAgent(agentId);
    if (skillPrompts) {
      instructions += '\n\n## 技能指南\n' + skillPrompts;
    }
  } catch {}

  // 构建 tools：Skill 工具 + RAG 工具
  const tools: Record<string, any> = {};
  try {
    const skillTools = await getSkillToolsForMastraAgent(agentId, {
      tenantId, agentId, userId, skillConfig: {},
    });
    Object.assign(tools, skillTools);
  } catch {}
  try {
    if (agentRow.rag_mode !== 'disabled') {
      const ragTool = await createRagSearchTool(agentRow);
      if (ragTool) tools[ragTool.id] = ragTool;
    }
  } catch {}

  return new Agent({
    id: `team-member-${agentId}`,
    name: agentRow.name,
    instructions,
    model: model as any,
    tools,
    maxRetries: 0,
    defaultOptions: { maxSteps: agentRow.max_steps ?? 10 },
  });
}

/**
 * 创建团队协作网络。
 *
 * @param teamId - 团队 ID
 * @param message - 用户消息
 * @param context - 运行时上下文 { tenantId, userId }
 * @returns stream 和 teamId
 */
export async function createTeamNetwork(
  teamId: string,
  message: string,
  context: { tenantId: string; userId: string },
): Promise<{ stream: MastraAgentNetworkStream; teamId: string }> {
  const teamConfig = await loadTeamConfig(teamId, context.tenantId);

  // 1. 为每个成员创建 Mastra Agent 实例
  const memberAgents: Record<string, Agent> = {};
  for (const member of teamConfig.members) {
    try {
      const agent = await createMemberAgent(
        member.agentId,
        context.tenantId,
        context.userId,
      );
      memberAgents[member.agentId] = agent;
      logger.info({ agentId: member.agentId, role: member.role }, 'Team member agent created');
    } catch (err) {
      logger.warn({ err, agentId: member.agentId }, 'Failed to create team member agent');
    }
  }

  if (Object.keys(memberAgents).length === 0) {
    throw new Error('Failed to create any team member agents');
  }

  // 2. 确定 Supervisor 的 model 和 instructions
  let supervisorModel: ReturnType<typeof resolveModelProvider>;
  let supervisorInstructions: string;

  if (teamConfig.supervisorAgentId) {
    // 使用指定的 supervisor agent 的配置（model + instructions）
    const supAgent = await createMemberAgent(
      teamConfig.supervisorAgentId,
      context.tenantId,
      context.userId,
    );
    supervisorModel = await supAgent.getModel();
    supervisorInstructions = (await supAgent.getInstructions()) as string;
  } else {
    // 使用默认模型 + 简单指令
    const modelConfig = await modelManager.getDefault(context.tenantId);
    if (!modelConfig) throw new Error('No LLM model configured');
    supervisorModel = resolveModelProvider(modelConfig);
    supervisorInstructions = `你是团队"${teamConfig.teamName}"的协调者。根据用户请求，分配合适的团队成员来处理任务。`;
  }

  // 3. 创建 Supervisor Agent（注入成员作为 sub-agents）
  const supervisor = new Agent({
    id: `team-supervisor-${teamId}`,
    name: `${teamConfig.teamName} Supervisor`,
    instructions: supervisorInstructions,
    model: supervisorModel,
    agents: memberAgents,
    maxRetries: 0,
    defaultOptions: { maxSteps: 15 },
  });

  // 4. 执行多 Agent 协作
  const stream = await supervisor.network([{ role: 'user', content: message }], {
    memory: {
      thread: `team-${teamId}-${context.userId}`,
      resource: context.tenantId,
    },
    maxSteps: 15,
  });

  logger.info({ teamId, memberCount: Object.keys(memberAgents).length }, 'Team network started');
  return { stream, teamId };
}
