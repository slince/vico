import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { SkillManifest, LoadedSkill, SkillTool } from './types.js';

export async function scanSkillDirs(scanPaths: string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const scanPath of scanPaths) {
    if (!existsSync(scanPath)) continue;
    const entries = readdirSync(scanPath);
    for (const entry of entries) {
      const fullPath = resolve(scanPath, entry);
      if (statSync(fullPath).isDirectory()) {
        const manifestPath = resolve(fullPath, 'manifest.json');
        if (existsSync(manifestPath)) {
          dirs.push(fullPath);
        }
      }
    }
  }
  return dirs;
}

export function loadManifest(skillDir: string): SkillManifest {
  const manifestPath = resolve(skillDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Skill manifest not found: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

export function loadPrompt(skillDir: string): string {
  const promptPath = resolve(skillDir, 'prompt.md');
  if (existsSync(promptPath)) {
    return readFileSync(promptPath, 'utf-8');
  }
  return '';
}

export async function loadTools(skillDir: string): Promise<SkillTool[]> {
  const toolsPath = resolve(skillDir, 'tools.ts');
  if (!existsSync(toolsPath)) return [];

  const mod = await import(toolsPath);
  if (typeof mod.default === 'function') {
    return mod.default();
  }
  if (Array.isArray(mod.default)) {
    return mod.default;
  }
  if (Array.isArray(mod.tools)) {
    return mod.tools;
  }
  return [];
}

export async function loadSkill(skillDir: string): Promise<LoadedSkill> {
  const manifest = loadManifest(skillDir);
  const prompt = loadPrompt(skillDir);
  const tools = await loadTools(skillDir);
  return { manifest, prompt, tools };
}

export function getResourcesDir(skillDir: string): string | null {
  const resPath = resolve(skillDir, 'resources');
  if (existsSync(resPath) && statSync(resPath).isDirectory()) {
    return resPath;
  }
  return null;
}
