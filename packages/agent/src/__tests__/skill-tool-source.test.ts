// src/__tests__/skill-tool-source.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager } from '../skill/skill-manager.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createSkillToolSource } from '../skill/skill-tool-source.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TMP = resolve('/tmp/vico-skill-tools-test-' + Date.now());

function createSkill(dir: string, name: string, description: string, instructions = '# Instructions'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`);
}

describe('SkillToolSource', () => {
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

  const makeCtx = () => ({ userId: 'u1', agentId: 'a1', threadId: 't1', workspace: '/', hooks: [], signal: new AbortController().signal, awaitApproval: async () => ({ approved: true }) });

  it('skill tool returns instructions', async () => {
    const source = createSkillToolSource(manager);
    const tools = await source.list(makeCtx() as any);
    const skill = tools.find((t) => t.name === 'skill')!;
    const result = await skill.execute({ name: 'code-review' }, makeCtx() as any);
    const parsed = JSON.parse(result as string);
    expect(parsed.name).toBe('code-review');
    expect(parsed.instructions).toContain('Check for bugs');
  });

  it('skill tool returns error for unknown skill', async () => {
    const source = createSkillToolSource(manager);
    const tools = await source.list(makeCtx() as any);
    const skill = tools.find((t) => t.name === 'skill')!;
    const result = await skill.execute({ name: 'nonexistent' }, makeCtx() as any);
    expect(result).toContain('not found');
  });

  it('skill_search finds matching skills', async () => {
    const source = createSkillToolSource(manager);
    const tools = await source.list(makeCtx() as any);
    const search = tools.find((t) => t.name === 'skill_search')!;
    const result = await search.execute({ query: 'review' }, makeCtx() as any) as string;
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('code-review');
  });

  it('skill_tools creates 3 tools', async () => {
    const source = createSkillToolSource(manager);
    const tools = await source.list(makeCtx() as any);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['skill', 'skill_read', 'skill_search']);
  });
});
