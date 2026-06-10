import { FastifyInstance } from 'fastify';
import { skillManager } from '../skill/manager.js';
import { getDb } from '../data/db.js';

export function skillRoutes(app: FastifyInstance) {
  app.get('/api/v1/skills', async (req) => {
    const ctx = req.authContext!;
    const installed = skillManager.getInstalledSkills(ctx.tenantId);
    const allManifests = skillManager.getAllManifests();

    // Merge: show all available skills with installation status
    return allManifests.map((m) => {
      const inst = (installed as any[]).find((i) => i.skill_name === m.name);
      return {
        ...m,
        installed: !!inst,
        installed_config: inst ? JSON.parse(inst.config) : {},
        installed_enabled: inst ? !!inst.enabled : false,
        installed_version: inst ? inst.version : null,
      };
    });
  });

  app.get('/api/v1/skills/:name', async (req, reply) => {
    const ctx = req.authContext!;
    const { name } = req.params as any;
    const manifest = skillManager.getManifest(name);
    if (!manifest) return reply.status(404).send({ error: 'Skill not found' });

    const db = getDb();
    const inst = db.prepare('SELECT * FROM installed_skills WHERE tenant_id = ? AND skill_name = ?').get(ctx.tenantId, name);

    return {
      ...manifest,
      installed: !!inst,
      installed_config: inst ? JSON.parse((inst as any).config) : {},
      installed_enabled: inst ? !!(inst as any).enabled : false,
    };
  });

  app.post('/api/v1/skills/install', async (req, reply) => {
    const ctx = req.authContext!;
    const { skill_name, config: cfg } = req.body as any;

    try {
      const result = await skillManager.installSkill(ctx.tenantId, skill_name, cfg || {});
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/skills/:name/config', async (req, reply) => {
    const ctx = req.authContext!;
    const { name } = req.params as any;
    const cfg = req.body as any;
    skillManager.updateSkillConfig(ctx.tenantId, name, cfg);
    return { message: 'updated' };
  });

  app.post('/api/v1/skills/:name/toggle', async (req, reply) => {
    const ctx = req.authContext!;
    const { name } = req.params as any;
    const { enabled } = req.body as any;
    skillManager.toggleSkill(ctx.tenantId, name, !!enabled);
    return { message: 'updated' };
  });

  app.delete('/api/v1/skills/:name', async (req, reply) => {
    const ctx = req.authContext!;
    const { name } = req.params as any;
    skillManager.uninstallSkill(ctx.tenantId, name);
    return { message: 'deleted' };
  });
}
