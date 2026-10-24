// src/skill/fs-skill-loader.ts
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { localFilesystem, type Filesystem } from '@vico/fs';
import type { Skill, SkillLoader } from './types.js';

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

/** 列出目录下的条目绝对路径；目录不可读时返回空数组 */
async function listDir(fs: Filesystem, dir: string): Promise<string[]> {
  try {
    const entries = await fs.readDir(dir);
    return entries.map((e) => resolve(dir, e.name));
  } catch {
    return [];
  }
}

/** 列出目录下的条目名；目录不存在或不可读时返回空数组 */
async function listNames(fs: Filesystem, dir: string): Promise<string[]> {
  try {
    const entries = await fs.readDir(dir);
    return entries.map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 从指定目录加载单个 Skill（读取 SKILL.md 并解析）。
 * @param dir - 包含 SKILL.md 的目录路径
 * @param fs - 文件系统实现，默认本地文件系统
 * @returns 解析后的 Skill 对象
 */
export async function loadSkillFromDir(dir: string, fs: Filesystem = localFilesystem): Promise<Skill> {
  const mdPath = resolve(dir, 'SKILL.md');
  const content = await fs.readTextFile(mdPath);
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
    references: await listNames(fs, referenceDir),
    scripts: await listNames(fs, scriptsDir),
    assets: await listNames(fs, assetsDir),
    metadata: data.metadata as Record<string, string> | undefined,
  };
}

/**
 * 从指定目录列表扫描并加载所有 Skill（按 name 去重）。
 * @param dirs - 待扫描的目录列表
 * @param fs - 文件系统实现，默认本地文件系统
 * @returns 加载成功的 Skill 列表
 */
export async function loadSkillsFromDirs(dirs: string[], fs: Filesystem = localFilesystem): Promise<Skill[]> {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const root of dirs) {
    const fullPath = resolve(expandTilde(root));

    // root 本身是否包含 SKILL.md？
    const directMd = resolve(fullPath, 'SKILL.md');
    if (await fs.exists(directMd) && !seen.has(fullPath)) {
      seen.add(fullPath);
      candidates.push(fullPath);
    }

    // 扫描一级子目录
    for (const entry of await listDir(fs, fullPath)) {
      try {
        if ((await fs.stat(entry)).isDirectory) {
          const subMd = resolve(entry, 'SKILL.md');
          if (await fs.exists(subMd) && !seen.has(entry)) {
            seen.add(entry);
            candidates.push(entry);
          }
        }
      } catch { /* skip */ }
    }
  }

  const skills: Skill[] = [];
  const nameCache = new Map<string, Skill>();

  for (const candidate of candidates) {
    try {
      const skill = await loadSkillFromDir(candidate, fs);
      if (!nameCache.has(skill.name)) {
        nameCache.set(skill.name, skill);
        skills.push(skill);
      }
    } catch { /* skip invalid skill */ }
  }

  return skills;
}

/**
 * 从文件系统创建 Skill 加载器 — 扫描指定目录并加载 SKILL.md。
 * @param dirs - 待扫描的目录列表
 * @param fs - 文件系统实现，默认本地文件系统
 * @returns 返回 Skill 数组的异步加载器
 */
export function createFSSkillLoader(dirs: string[], fs: Filesystem = localFilesystem): SkillLoader {
  return async () => loadSkillsFromDirs(dirs, fs);
}
