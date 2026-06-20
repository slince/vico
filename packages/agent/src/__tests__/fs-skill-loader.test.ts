// src/__tests__/fs-skill-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';

const TMP = resolve('/tmp/vico-skill-test-' + Date.now());

function createSkill(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n\nTest skill.`,
  );
}

describe('FSSkillLoader', () => {
  beforeEach(() => mkdirSync(TMP, { recursive: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('discovers skill from root directory', async () => {
    createSkill(TMP, 'test-skill', 'A test skill');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
  });

  it('discovers skills from subdirectories', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    createSkill(resolve(TMP, 'skill-b'), 'skill-b', 'Second');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(2);
  });

  it('loads single skill by path', async () => {
    createSkill(resolve(TMP, 'my-skill'), 'my-skill', 'My skill');
    const loader = new FSSkillLoader();
    const skill = await loader.load(resolve(TMP, 'my-skill'));
    expect(skill.name).toBe('my-skill');
    expect(skill.instructions).toContain('Test skill');
  });

  it('refresh clears and reloads', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    const loader = new FSSkillLoader();
    const firstDiscover = await loader.discover([TMP]);
    expect(firstDiscover).toHaveLength(1);
    // Add another skill and refresh
    createSkill(resolve(TMP, 'skill-b'), 'skill-b', 'Second');
    await loader.refresh([TMP]);
    // After refresh, both skills should be loadable via their paths
    const skillA = await loader.load(resolve(TMP, 'skill-a'));
    const skillB = await loader.load(resolve(TMP, 'skill-b'));
    expect(skillA.name).toBe('skill-a');
    expect(skillB.name).toBe('skill-b');
  });

  it('rejects skill with invalid name', async () => {
    mkdirSync(resolve(TMP, 'bad-skill'), { recursive: true });
    writeFileSync(resolve(TMP, 'bad-skill', 'SKILL.md'), '---\nname: INVALID NAME\n---\n\nbad');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(0); // silently skipped
  });
});
