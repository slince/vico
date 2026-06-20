// src/__tests__/skill-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager } from '../skill/skill-manager.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createSkillTools, createSkillToolHandlers } from '../skill/skill-tools.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TMP = resolve('/tmp/vico-skill-tools-test-' + Date.now());

function createSkill(dir: string, name: string, description: string, instructions = '# Instructions'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`);
}

describe('SkillTools', () => {
  let manager: SkillManager;

  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true });
    createSkill(resolve(TMP, 'code-review'), 'code-review', 'Review code changes', 'Check for bugs and style issues.');
    createSkill(resolve(TMP, 'deploy'), 'deploy', 'Deployment guide', 'Steps to deploy the application.');
    const loader = new FSSkillLoader();
    manager = new SkillManager(loader);
    await manager.discover([TMP]);
  });

  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('skill tool returns instructions', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill.execute({ name: 'code-review' });
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('code-review');
    expect(parsed.instructions).toContain('Check for bugs');
  });

  it('skill tool returns error for unknown skill', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill.execute({ name: 'nonexistent' });
    expect(result).toContain('not found');
  });

  it('skill_search finds matching skills', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill_search.execute({ query: 'review' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('code-review');
  });

  it('skill_tools creates 3 tools', () => {
    const tools = createSkillTools(manager);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['skill', 'skill_read', 'skill_search']);
  });
});
