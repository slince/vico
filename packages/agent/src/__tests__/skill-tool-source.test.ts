// src/__tests__/skill-tool-source.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillRegistry } from '../skill/skill-registry.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createAllSkillTools } from '../skill/tool/index.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TMP = resolve('/tmp/vico-skill-tools-test-' + Date.now());

function createSkill(dir: string, name: string, description: string, instructions = '# Instructions'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`);
}

describe('SkillToolSource', () => {
  let manager: SkillRegistry;

  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true });
    createSkill(resolve(TMP, 'code-review'), 'code-review', 'Review code changes', 'Check for bugs and style issues.');
    createSkill(resolve(TMP, 'deploy'), 'deploy', 'Deployment guide', 'Steps to deploy the application.');
    const loader = new FSSkillLoader();
    manager = new SkillRegistry([loader]);
    await manager.discover([TMP]);
  });

  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  const makeCtx = () => ({ userId: 'u1', agentId: 'a1', threadId: 't1', workspace: '/', signal: new AbortController().signal, awaitApproval: async () => ({ approved: true }) });

  it('skill tool returns instructions', async () => {
    const tools = createAllSkillTools(manager);
    const skill = tools.find((t) => t.name === 'skill')!;
    const result = await skill.execute({ id: '1', name: 'skill', args: { name: 'code-review' } }, makeCtx() as any) as any;
    expect(result.name).toBe('code-review');
    expect(result.instructions).toContain('Check for bugs');
  });

  it('skill tool throws error for unknown skill', async () => {
    const tools = createAllSkillTools(manager);
    const skill = tools.find((t) => t.name === 'skill')!;
    await expect(
      skill.execute({ id: '2', name: 'skill', args: { name: 'nonexistent' } }, makeCtx() as any)
    ).rejects.toThrow('not found');
  });

  it('skill_search finds matching skills', async () => {
    const tools = createAllSkillTools(manager);
    const search = tools.find((t) => t.name === 'skill_search')!;
    const result = await search.execute({ id: '3', name: 'skill_search', args: { query: 'review' } }, makeCtx() as any) as any;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('code-review');
  });

  it('skill_tools creates 3 tools', async () => {
    const tools = createAllSkillTools(manager);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['skill', 'skill_read', 'skill_search']);
  });
});
