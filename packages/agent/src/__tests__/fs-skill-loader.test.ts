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

  it('loads skill from root directory', async () => {
    createSkill(TMP, 'test-skill', 'A test skill');
    const loader = new FSSkillLoader([TMP]);
    const skills = await loader.load();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
  });

  it('loads skills from subdirectories', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    createSkill(resolve(TMP, 'skill-b'), 'skill-b', 'Second');
    const loader = new FSSkillLoader([TMP]);
    const skills = await loader.load();
    expect(skills).toHaveLength(2);
  });

  it('loads skills from multiple root dirs', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    const TMP2 = resolve('/tmp/vico-skill-test-2-' + Date.now());
    mkdirSync(TMP2, { recursive: true });
    createSkill(resolve(TMP2, 'skill-b'), 'skill-b', 'Second');
    try {
      const loader = new FSSkillLoader([TMP, TMP2]);
      const skills = await loader.load();
      expect(skills).toHaveLength(2);
    } finally {
      rmSync(TMP2, { recursive: true, force: true });
    }
  });

  it('deduplicates skills with same name', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'my-skill', 'First');
    createSkill(resolve(TMP, 'skill-b'), 'my-skill', 'Duplicate');
    const loader = new FSSkillLoader([TMP]);
    const skills = await loader.load();
    expect(skills).toHaveLength(1);
  });

  it('rejects skill with invalid name', async () => {
    mkdirSync(resolve(TMP, 'bad-skill'), { recursive: true });
    writeFileSync(resolve(TMP, 'bad-skill', 'SKILL.md'), '---\nname: INVALID NAME\n---\n\nbad');
    const loader = new FSSkillLoader([TMP]);
    const skills = await loader.load();
    expect(skills).toHaveLength(0); // silently skipped
  });
});
