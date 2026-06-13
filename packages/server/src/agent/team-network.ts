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
import { createAgent, resolveModelProvider } from './agent-factory.js';
import { getDefaultModel } from './model-registry.js';
import logger from '../lib/logger.js';

const { agentTeams, agentTeamMembers } = schema;

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
      const agent = await createAgent({
        tenantId: context.tenantId,
        agentId: member.agentId,
        userId: context.userId,
      });
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
    const supAgent = await createAgent({
      tenantId: context.tenantId,
      agentId: teamConfig.supervisorAgentId,
      userId: context.userId,
    });
    supervisorModel = await supAgent.getModel();
    supervisorInstructions = (await supAgent.getInstructions()) as string;
  } else {
    // 使用默认模型 + 简单指令
    const modelConfig = await getDefaultModel(context.tenantId);
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
