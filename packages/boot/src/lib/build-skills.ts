// @vico/boot - Skill 装配工具（扫描文件系统 + inline skills 合并）

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createFSSkillLoader, type Skill } from '@vico/skill';

/** 各产品全局 Skills 默认目录 */
const COMPATIBLE_SKILL_ROOTS = [
  '.claude/skills',
  '.openclaw/skills',
  '.hermes/skills',
  '.agents/skills',
];

/** Skill 扫描配置 */
export type SkillSettings = {
  /** Vico 原生 Skill 扫描根目录 */
  skillDirs?: string[];

  skills?: Skill[];

  /** 开启后自动扫描第三方 AI Agent 产品的全局 Skills（Claude、OpenClaw、Hermes、通用 agents） */
  compatible?: boolean;
};

export type SkillOptions = Skill[] | SkillSettings;

/**
 * 汇总 SkillSettings 中所有待扫描目录。
 *
 * @param settings - Skill 扫描配置
 * @returns 所有待扫描的绝对路径列表
 */
function collectSkillDirs(settings: SkillSettings): string[] {
  const dirs: string[] = [];
  if (settings.skillDirs) {
    dirs.push(...settings.skillDirs);
  }
  if (settings.compatible) {
    const home = homedir();
    for (const rel of COMPATIBLE_SKILL_ROOTS) {
      dirs.push(resolve(home, rel));
    }
  }
  return dirs;
}

/**
 * 装配 Skill 列表：文件系统扫描 + inline skills 合并。
 *
 * - `undefined` / 空 → `[]`
 * - `Skill[]` 数组形式 → 原样返回
 * - `SkillSettings` 对象形式 → 按 `skillDirs` 扫描，`compatible` 时追加全局第三方 Skills 目录，再合并 `skills`
 *
 * @param skillsOptions - Skill 装配选项
 * @returns 解析后的 Skill 列表
 */
export async function buildSkills(skillsOptions?: SkillOptions): Promise<Skill[]> {
  if (!skillsOptions) {
    return [];
  }

  // Skill[] 数组形式
  if (Array.isArray(skillsOptions)) {
    return skillsOptions;
  }

  // SkillSettings 对象形式
  const { skills: inlineSkills } = skillsOptions;
  const dirs = collectSkillDirs(skillsOptions);
  const all: Skill[] = [];
  if (dirs.length) {
    const fsLoader = createFSSkillLoader(dirs);
    all.push(...await fsLoader());
  }
  if (inlineSkills) {
    all.push(...inlineSkills);
  }
  return all;
}
