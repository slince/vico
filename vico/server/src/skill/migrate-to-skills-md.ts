// src/skill/migrate-to-skills-md.ts
// 将旧 manifest.json + prompt.md + tools.ts → 新 SKILL.md 格式
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function migrateManifestToSKILLMD(skillDir: string): void {
  const manifestPath = resolve(skillDir, 'manifest.json');
  const promptPath = resolve(skillDir, 'prompt.md');

  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json found in ${skillDir}`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';

  const frontmatter = [
    `name: ${manifest.name}`,
    `description: ${manifest.description || ''}`,
    manifest.author ? `author: ${manifest.author}` : '',
    `version: ${manifest.version || '1.0.0'}`,
    manifest.category ? `metadata:\n  category: ${manifest.category}` : '',
  ].filter(Boolean).join('\n');

  const skillsMD = `---\n${frontmatter}\n---\n\n${prompt}`;
  writeFileSync(resolve(skillDir, 'SKILL.md'), skillsMD);
  console.log(`Migrated ${skillDir} to SKILL.md`);
}
