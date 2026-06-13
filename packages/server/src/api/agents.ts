import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';
import { agentToolCache } from '../agent/mastra/cache/agent-tool-cache.js';

const { agents, agent_skills, agent_knowledge_bases } = schema;

export function agentRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/agents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();
    const rows = await db.select().from(agents)
      .where(eq(agents.tenant_id, auth.tenantId))
      .orderBy(desc(agents.updated_at))
      .all();

    // Enrich with bound skills and knowledge bases
    const result = [];
    for (const a of rows) {
      const skills = await db.select({ skill_name: agent_skills.skill_name })
        .from(agent_skills).where(eq(agent_skills.agent_id, a.id)).all();
      const kbs = await db.select({ kb_id: agent_knowledge_bases.kb_id })
        .from(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, a.id)).all();
      result.push({
        ...a,
        skill_names: skills.map((s) => s.skill_name),
        kb_ids: kbs.map((k) => k.kb_id),
      });
    }

    return c.json(result);
  });

  app.post('/api/v1/agents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const { name, system_prompt, model_id, temperature, max_tokens, max_steps, rag_mode } = await c.req.json();

    const db = getDb();
    const id = uuid();
    const now = Date.now();
    await db.insert(agents).values({
      id, tenant_id: auth.tenantId, name,
      system_prompt: system_prompt || '', model_id: model_id || '',
      temperature: temperature ?? 0.7, max_tokens: max_tokens ?? 4096,
      max_steps: max_steps ?? 10, rag_mode: rag_mode || 'auto', enabled: 1,
      created_at: now, updated_at: now,
    }).run();
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ id, message: 'created' });
  });

  app.get('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();

    const agent = await db.select().from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId)))
      .get();

    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const skills = await db.select({ skill_name: agent_skills.skill_name, config: agent_skills.config })
      .from(agent_skills).where(eq(agent_skills.agent_id, id)).all();
    const kbs = await db.select({ kb_id: agent_knowledge_bases.kb_id, mode: agent_knowledge_bases.mode })
      .from(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, id)).all();

    return c.json({ ...agent, skills, knowledge_bases: kbs });
  });

  app.patch('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDb();

    const agent = await db.select().from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId)))
      .get();

    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const allowed = ['name', 'system_prompt', 'model_id', 'temperature', 'max_tokens', 'max_steps', 'rag_mode', 'enabled'];
    const updateData: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowed.includes(k) && v !== undefined) {
        updateData[k] = v;
      }
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = Date.now();
      await db.update(agents).set(updateData)
        .where(and(eq(agents.tenant_id, auth.tenantId), eq(agents.id, id)))
        .run();
    }

    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'updated' });
  });

  app.delete('/api/v1/agents/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    await db.delete(agent_skills).where(eq(agent_skills.agent_id, id)).run();
    await db.delete(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, id)).run();
    await db.delete(agents).where(and(eq(agents.id, id), eq(agents.tenant_id, auth.tenantId))).run();
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'deleted' });
  });

  app.put('/api/v1/agents/:id/skills', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const { skills } = await c.req.json() as { skills: { skill_name: string; config?: Record<string, any> }[] } || { skills: [] };
    const db = getDb();

    await db.delete(agent_skills).where(eq(agent_skills.agent_id, id)).run();
    for (const s of skills) {
      await db.insert(agent_skills).values({
        agent_id: id, skill_name: s.skill_name,
        config: JSON.stringify(s.config || {}),
      }).onConflictDoUpdate({
        target: [agent_skills.agent_id, agent_skills.skill_name],
        set: { config: JSON.stringify(s.config || {}) },
      }).run();
    }
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'updated' });
  });

  app.put('/api/v1/agents/:id/knowledge', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const { knowledge_bases } = await c.req.json() as { knowledge_bases: { kb_id: string; mode?: string }[] } || { knowledge_bases: [] };
    const db = getDb();

    await db.delete(agent_knowledge_bases).where(eq(agent_knowledge_bases.agent_id, id)).run();
    for (const kb of knowledge_bases) {
      await db.insert(agent_knowledge_bases).values({
        agent_id: id, kb_id: kb.kb_id, mode: kb.mode || 'auto',
      }).onConflictDoUpdate({
        target: [agent_knowledge_bases.agent_id, agent_knowledge_bases.kb_id],
        set: { mode: kb.mode || 'auto' },
      }).run();
    }
    agentToolCache.invalidate(auth.tenantId);
    return c.json({ message: 'updated' });
  });
}
