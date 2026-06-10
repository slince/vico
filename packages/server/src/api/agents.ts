import { FastifyInstance } from 'fastify';
import { getDb } from '../data/db.js';
import { v4 as uuid } from 'uuid';

export function agentRoutes(app: FastifyInstance) {
  app.get('/api/v1/agents', async (req, reply) => {
    const ctx = req.authContext!;
    const db = getDb();
    const agents = db.prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY updated_at DESC').all(ctx.tenantId);

    // Enrich with bound skills
    const result = (agents as any[]).map((a) => {
      const skills = db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(a.id) as { skill_name: string }[];
      const kbs = db.prepare('SELECT kb_id FROM agent_knowledge_bases WHERE agent_id = ?').all(a.id) as { kb_id: string }[];
      return { ...a, skill_names: skills.map((s) => s.skill_name), kb_ids: kbs.map((k) => k.kb_id) };
    });

    return result;
  });

  app.post('/api/v1/agents', async (req, reply) => {
    const ctx = req.authContext!;
    const { name, system_prompt, model_id, temperature, max_tokens, rag_mode } = req.body as any;

    const db = getDb();
    const id = uuid();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (id, tenant_id, name, system_prompt, model_id, temperature, max_tokens, rag_mode, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
      id, ctx.tenantId, name, system_prompt || '', model_id || '', temperature || 0.7, max_tokens || 4096, rag_mode || 'auto', now, now
    );
    return { id, message: 'created' };
  });

  app.get('/api/v1/agents/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();

    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const skills = db.prepare('SELECT skill_name, config FROM agent_skills WHERE agent_id = ?').all(id);
    const kbs = db.prepare('SELECT kb_id, mode FROM agent_knowledge_bases WHERE agent_id = ?').all(id);

    return { ...agent as any, skills, knowledge_bases: kbs };
  });

  app.patch('/api/v1/agents/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const body = req.body as any;
    const db = getDb();

    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const allowed = ['name', 'system_prompt', 'model_id', 'temperature', 'max_tokens', 'rag_mode', 'enabled'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (allowed.includes(k) && v !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      vals.push(Date.now());
      vals.push(ctx.tenantId, id);
      db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...vals);
    }

    return { message: 'updated' };
  });

  app.delete('/api/v1/agents/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();
    db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM agent_knowledge_bases WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM agents WHERE id = ? AND tenant_id = ?').run(id, ctx.tenantId);
    return { message: 'deleted' };
  });

  app.put('/api/v1/agents/:id/skills', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const { skills } = req.body as { skills: { skill_name: string; config?: Record<string, any> }[] } || { skills: [] };
    const db = getDb();

    db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(id);
    for (const s of skills) {
      db.prepare('INSERT OR REPLACE INTO agent_skills (agent_id, skill_name, config) VALUES (?, ?, ?)').run(
        id, s.skill_name, JSON.stringify(s.config || {})
      );
    }
    return { message: 'updated' };
  });

  app.put('/api/v1/agents/:id/knowledge', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const { knowledge_bases } = req.body as { knowledge_bases: { kb_id: string; mode?: string }[] } || { knowledge_bases: [] };
    const db = getDb();

    db.prepare('DELETE FROM agent_knowledge_bases WHERE agent_id = ?').run(id);
    for (const kb of knowledge_bases) {
      db.prepare('INSERT OR REPLACE INTO agent_knowledge_bases (agent_id, kb_id, mode) VALUES (?, ?, ?)').run(
        id, kb.kb_id, kb.mode || 'auto'
      );
    }
    return { message: 'updated' };
  });
}
