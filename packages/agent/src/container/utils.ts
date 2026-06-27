// @vico/agent - container utilities
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Skill 扫描配置 */
export type SkillSettings = {
  /** Vico 原生 Skill 扫描根目录 */
  skillDirs?: string[];
  /** 开启后自动扫描第三方 AI Agent 产品的全局 Skills（Claude、OpenClaw、Hermes、通用 agents） */
  compatible?: boolean;
};

/** 各产品全局 Skills 默认目录 */
export const COMPATIBLE_SKILL_ROOTS = [
  '.claude/skills',
  '.openclaw/skills',
  '.hermes/skills',
  '.agents/skills',
];

/**
 * 汇总 SkillSettings 中所有待扫描目录
 * @param settings - Skill 扫描配置
 * @returns 所有待扫描的绝对路径列表
 */
export function collectSkillDirs(settings: SkillSettings): string[] {
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
