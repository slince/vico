import {Hono} from 'hono';
import type {Variables} from '../index.js';
import {getAuthContext} from './helpers.js';
import {vico} from '../vico.js';

/**
 * Skill 路由 — 只读展示 Vico 扫描到的 Skill。
 * 数据来自 @vico/core 的 vico.listSkills()，去掉 path/instructions 等敏感/冗余字段。
 */
export function skillRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/skills', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const skills = await vico.listSkills();
    return c.json(skills.map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      license: s.license,
      compatibility: s.compatibility,
      userInvocable: s.userInvocable,
      references: s.references,
      scripts: s.scripts,
      assets: s.assets,
      metadata: s.metadata,
    })));
  });
}
