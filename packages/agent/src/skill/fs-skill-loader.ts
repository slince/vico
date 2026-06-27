// src/skill/fs-skill-loader.ts
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import matter from 'gray-matter';
import type {Skill, SkillLoader} from './types.js';

/**
 * 展开路径中的 ~ 前缀为家目录。
 * @param p - 可能包含 ~ 前缀的路径字符串
 * @returns 展开 ~ 后的绝对路径
 */
function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(p.startsWith('~/') ? 2 : 1));
  }
  return p;
}

/**
 * 验证 SKILL.md 的 name 字段：1-64 字符，小写字母+连字符。
 * @param name - 待验证的 skill 名称
 * @returns 是否为合法的 skill 名称
 */
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
      const fullPath = resolve(expandTilde(root));

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
    const fullPath = resolve(expandTilde(skillPath));
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
    const { data, content: body } = matter(content);

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
