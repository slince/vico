import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';

const { agentTeams, agentTeamMembers, agents } = schema;

export function teamRoutes(app: Hono<{ Variables: Variables }>) {
  /** GET /api/v1/teams — list all teams for tenant with member count */
  app.get('/api/v1/teams', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();

    const rows = db.select().from(agentTeams)
      .where(eq(agentTeams.tenant_id, auth.tenantId))
      .orderBy(desc(agentTeams.updated_at))
      .all();

    const result = rows.map((team) => {
      const count = db.select({ id: agentTeamMembers.id })
        .from(agentTeamMembers)
        .where(eq(agentTeamMembers.team_id, team.id))
        .all().length;
      return { ...team, member_count: count };
    });

    return c.json(result);
  });

  /** POST /api/v1/teams — create a team */
  app.post('/api/v1/teams', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();
    const body = await c.req.json();
    const { name, description, routing_strategy, supervisor_agent_id, member_ids } = body;

    if (!name || !name.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const id = uuid();
    const now = Date.now();
    db.insert(agentTeams).values({
      id,
      tenant_id: auth.tenantId,
      name: name.trim(),
      description: description || '',
      routing_strategy: routing_strategy || 'supervisor',
      supervisor_agent_id: supervisor_agent_id || null,
      created_at: now,
      updated_at: now,
    }).run();

    if (member_ids && Array.isArray(member_ids) && member_ids.length > 0) {
      for (const agentId of member_ids) {
        db.insert(agentTeamMembers).values({
          id: uuid(),
          team_id: id,
          agent_id: agentId,
          role: 'member',
          created_at: now,
        }).run();
      }
    }

    return c.json({ id, message: 'created' });
  });

  /** GET /api/v1/teams/:id — team detail with members */
  app.get('/api/v1/teams/:id', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();

    const team = db.select().from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, auth.tenantId)))
      .get();

    if (!team) return c.json({ error: 'Team not found' }, 404);

    const members = db.select({
      id: agentTeamMembers.id,
      agent_id: agentTeamMembers.agent_id,
      role: agentTeamMembers.role,
      agent_name: agents.name,
    })
      .from(agentTeamMembers)
      .leftJoin(agents, eq(agentTeamMembers.agent_id, agents.id))
      .where(eq(agentTeamMembers.team_id, id))
      .all();

    return c.json({ ...team, members });
  });

  /** PATCH /api/v1/teams/:id — update team fields */
  app.patch('/api/v1/teams/:id', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDb();

    const team = db.select().from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, auth.tenantId)))
      .get();

    if (!team) return c.json({ error: 'Team not found' }, 404);

    const allowed = ['name', 'description', 'routing_strategy', 'supervisor_agent_id'];
    const updateData: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) updateData[k] = body[k];
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = Date.now();
      db.update(agentTeams).set(updateData)
        .where(and(eq(agentTeams.tenant_id, auth.tenantId), eq(agentTeams.id, id)))
        .run();
    }

    return c.json({ message: 'updated' });
  });

  /** DELETE /api/v1/teams/:id — delete team (cascade members) */
  app.delete('/api/v1/teams/:id', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();

    db.delete(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, auth.tenantId)))
      .run();

    return c.json({ message: 'deleted' });
  });

  /** PUT /api/v1/teams/:id/members — replace all members */
  app.put('/api/v1/teams/:id/members', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const body = await c.req.json();
    const { members: memberList } = body as {
      members: { agent_id: string; role?: string }[];
    } || { members: [] };
    const db = getDb();

    const team = db.select().from(agentTeams)
      .where(and(eq(agentTeams.id, id), eq(agentTeams.tenant_id, auth.tenantId)))
      .get();

    if (!team) return c.json({ error: 'Team not found' }, 404);

    db.delete(agentTeamMembers).where(eq(agentTeamMembers.team_id, id)).run();
    const now = Date.now();
    for (const m of memberList) {
      db.insert(agentTeamMembers).values({
        id: uuid(),
        team_id: id,
        agent_id: m.agent_id,
        role: m.role || 'member',
        created_at: now,
      }).run();
    }

    db.update(agentTeams).set({ updated_at: now })
      .where(eq(agentTeams.id, id)).run();

    return c.json({ message: 'updated' });
  });
}
