import { eq, and, desc, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import {
  createTeamSchema,
  updateTeamSchema,
  replaceMembersSchema,
  type CreateTeamInput,
  type UpdateTeamInput,
  type TeamWithMembers,
  type TeamDetail,
  type TeamMemberDetail,
} from './types.js';

const { agentTeams, agentTeamMembers, agents } = schema;

/**
 * 团队业务管理器。
 * 封装团队 CRUD、成员管理和关联查询。
 */
class TeamManager {
  /** 获取租户下所有团队，含 member_count */
  async list(tenantId: string): Promise<TeamWithMembers[]> {
    const db = getDb();
    const rows = await db.select().from(agentTeams)
      .where(eq(agentTeams.tenant_id, tenantId))
      .orderBy(desc(agentTeams.updated_at))
      .all();

    if (rows.length === 0) return [];

    const teamIds = rows.map((t) => t.id);

    // 批量查询成员数，消除 N+1
    const allMembers = await db.select({
      team_id: agentTeamMembers.team_id,
      id: agentTeamMembers.id,
    })
      .from(agentTeamMembers)
      .where(inArray(agentTeamMembers.team_id, teamIds))
      .all();

    const countMap = new Map<string, number>();
    for (const m of allMembers) {
      countMap.set(m.team_id, (countMap.get(m.team_id) || 0) + 1);
    }

    return rows.map((t) => ({
      ...t,
      member_count: countMap.get(t.id) || 0,
    }));
  }

  /** 获取团队详情（含成员列表，LEFT JOIN agents 取 agent_name） */
  async getById(tenantId: string, id: string): Promise<TeamDetail | null> {
    const db = getDb();
    const team = await db.select().from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, tenantId)))
      .get();
    if (!team) return null;

    const members = await db.select({
      id: agentTeamMembers.id,
      agent_id: agentTeamMembers.agent_id,
      role: agentTeamMembers.role,
      agent_name: agents.name,
    })
      .from(agentTeamMembers)
      .leftJoin(agents, eq(agentTeamMembers.agent_id, agents.id))
      .where(eq(agentTeamMembers.team_id, id))
      .all();

    return { ...team, members: members as TeamMemberDetail[] };
  }

  /** 创建团队 */
  async create(tenantId: string, input: unknown): Promise<TeamDetail> {
    const data = createTeamSchema.parse(input) as CreateTeamInput;
    const db = getDb();
    const id = uuid();
    const now = Date.now();

    await db.insert(agentTeams).values({
      id,
      tenant_id: tenantId,
      name: data.name.trim(),
      description: data.description,
      routing_strategy: data.routing_strategy,
      supervisor_agent_id: data.supervisor_agent_id,
      created_at: now,
      updated_at: now,
    }).run();

    if (data.member_ids && data.member_ids.length > 0) {
      for (const agentId of data.member_ids) {
        await db.insert(agentTeamMembers).values({
          id: uuid(),
          team_id: id,
          agent_id: agentId,
          role: 'member',
          created_at: now,
        }).run();
      }
    }

    return (await this.getById(tenantId, id))!;
  }

  /** 更新团队字段 */
  async update(tenantId: string, id: string, input: unknown): Promise<void> {
    const db = getDb();
    const existing = await db.select({ id: agentTeams.id }).from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, tenantId)))
      .get();
    if (!existing) throw new Error('Team not found');

    const parsed = updateTeamSchema.parse(input) as UpdateTeamInput;
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) updateData[k] = v;
    }
    if (Object.keys(updateData).length === 0) return;

    updateData.updated_at = Date.now();
    await db.update(agentTeams).set(updateData)
      .where(and(eq(agentTeams.tenant_id, tenantId), eq(agentTeams.id, id)))
      .run();
  }

  /** 删除团队（members 由 FK cascade 自动删除） */
  async remove(tenantId: string, id: string): Promise<void> {
    const db = getDb();
    await db.delete(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, tenantId)))
      .run();
  }

  /** 替换团队所有成员 */
  async replaceMembers(tenantId: string, id: string, input: unknown): Promise<void> {
    const { members: memberList } = replaceMembersSchema.parse(input);
    const db = getDb();

    const team = await db.select({ id: agentTeams.id }).from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, tenantId)))
      .get();
    if (!team) throw new Error('Team not found');

    await db.delete(agentTeamMembers).where(eq(agentTeamMembers.team_id, id)).run();
    const now = Date.now();
    for (const m of memberList) {
      await db.insert(agentTeamMembers).values({
        id: uuid(),
        team_id: id,
        agent_id: m.agent_id,
        role: m.role || 'member',
        created_at: now,
      }).run();
    }
    await db.update(agentTeams).set({ updated_at: now })
      .where(eq(agentTeams.id, id)).run();
  }
}

/** 团队业务管理器单例 */
export const teamManager = new TeamManager();
