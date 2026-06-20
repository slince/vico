// src/skill/fs-skill-loader.ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Skill, SkillLoader } from './skill-loader.js';

/** 简易 YAML frontmatter 解析器 */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, unknown> = {};
  const yamlBlock = match[1];
  // 简易解析：仅支持 key: value 格式
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else if (/^\d+$/.test(value)) data[key] = parseInt(value, 10);
    else data[key] = value;
  }

  return { data, body: match[2] };
}

/** 验证 SKILL.md 的 name 字段：1-64 字符，小写字母+连字符 */
function validateSkillName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && name.length >= 1 && name.length <= 64;
}

function listDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    return entries.map((e) => resolve(dir, e));
  } catch {
    return [];
  }
}

/** 文件系统 Skill 加载器 — 扫描目录中的 SKILL.md 文件 */
export class FSSkillLoader implements SkillLoader {
  private loadedSkills: Map<string, Skill> = new Map();

  async discover(roots: string[]): Promise<Skill[]> {
    const candidates: string[] = [];

    for (const root of roots) {
      const fullPath = resolve(root);

      // root 本身是否包含 SKILL.md？
      const directMd = resolve(fullPath, 'SKILL.md');
      if (existsSync(directMd)) {
        candidates.push(fullPath);
      }

      // 扫描一级子目录
      for (const entry of listDir(fullPath)) {
        try {
          if (statSync(entry).isDirectory()) {
            const subMd = resolve(entry, 'SKILL.md');
            if (existsSync(subMd)) {
              candidates.push(entry);
            }
          }
        } catch { /* skip */ }
      }
    }

    // 加载每个候选项
    const skills: Skill[] = [];
    for (const candidate of candidates) {
      try {
        const skill = await this.loadSkillFromDir(candidate);
        const existing = this.loadedSkills.get(skill.name);
        if (!existing) {
          this.loadedSkills.set(skill.name, skill);
          skills.push(skill);
        }
      } catch { /* skip invalid skill */ }
    }

    return skills;
  }

  async load(skillPath: string): Promise<Skill> {
    const fullPath = resolve(skillPath);
    if (!existsSync(resolve(fullPath, 'SKILL.md'))) {
      throw new Error(`SKILL.md not found in ${fullPath}`);
    }
    return this.loadSkillFromDir(fullPath);
  }

  async refresh(roots: string[]): Promise<void> {
    this.loadedSkills.clear();
    await this.discover(roots);
  }

  private async loadSkillFromDir(dir: string): Promise<Skill> {
    const mdPath = resolve(dir, 'SKILL.md');
    const content = readFileSync(mdPath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    const name = data.name as string;
    if (!validateSkillName(name)) {
      throw new Error(`Invalid skill name in ${dir}: "${name}". Must be 1-64 lowercase alphanumeric with hyphens.`);
    }

    const referenceDir = resolve(dir, 'references');
    const scriptsDir = resolve(dir, 'scripts');
    const assetsDir = resolve(dir, 'assets');

    return {
      name,
      description: (data.description as string) || '',
      instructions: body.trim(),
      path: dir,
      source: 'local',
      license: data.license as string | undefined,
      compatibility: data.compatibility as string | undefined,
      userInvocable: data['user-invocable'] !== false,
      references: existsSync(referenceDir) ? readdirSync(referenceDir) : [],
      scripts: existsSync(scriptsDir) ? readdirSync(scriptsDir) : [],
      assets: existsSync(assetsDir) ? readdirSync(assetsDir) : [],
      metadata: data.metadata as Record<string, string> | undefined,
    };
  }
}
