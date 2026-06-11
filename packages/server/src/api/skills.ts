import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { skillManager } from '../skill/manager.js';
import { getDb, schema } from '../data/db.js';

const { installed_skills } = schema;

export function skillRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/skills', (c) => {
    const auth = c.get('auth');
    const installed = skillManager.getInstalledSkills(auth.tenantId);
    const allManifests = skillManager.getAllManifests();

    return c.json(allManifests.map((m) => {
      const inst = installed.find((i) => i.skill_name === m.name);
      return {
        ...m,
        installed: !!inst,
        installed_config: inst ? JSON.parse(inst.config) : {},
        installed_enabled: inst ? !!inst.enabled : false,
        installed_version: inst ? inst.version : null,
      };
    }));
  });

  app.get('/api/v1/skills/:name', (c) => {
    const auth = c.get('auth');
    const name = c.req.param('name');
    const manifest = skillManager.getManifest(name);
    if (!manifest) return c.json({ error: 'Skill not found' }, 404);

    const db = getDb();
    const inst = db.select().from(installed_skills)
      .where(and(eq(installed_skills.tenant_id, auth.tenantId), eq(installed_skills.skill_name, name)))
      .get();

    return c.json({
      ...manifest,
      installed: !!inst,
      installed_config: inst ? JSON.parse(inst.config) : {},
      installed_enabled: inst ? !!inst.enabled : false,
    });
  });

  app.post('/api/v1/skills/install', async (c) => {
    const auth = c.get('auth');
    const { skill_name, config: cfg } = await c.req.json();

    try {
      const result = await skillManager.installSkill(auth.tenantId, skill_name, cfg || {});
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.patch('/api/v1/skills/:name/config', async (c) => {
    const auth = c.get('auth');
    const name = c.req.param('name');
    const cfg = await c.req.json();
    skillManager.updateSkillConfig(auth.tenantId, name, cfg);
    return c.json({ message: 'updated' });
  });

  app.post('/api/v1/skills/:name/toggle', async (c) => {
    const auth = c.get('auth');
    const name = c.req.param('name');
    const { enabled } = await c.req.json();
    skillManager.toggleSkill(auth.tenantId, name, !!enabled);
    return c.json({ message: 'updated' });
  });

  app.delete('/api/v1/skills/:name', (c) => {
    const auth = c.get('auth');
    const name = c.req.param('name');
    skillManager.uninstallSkill(auth.tenantId, name);
    return c.json({ message: 'deleted' });
  });
}
