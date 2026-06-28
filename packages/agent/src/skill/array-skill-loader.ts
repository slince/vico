// src/skill/array-skill-loader.ts
import type {Skill, SkillLoader} from './types.js';

/** 从内存中的 Skill 数组创建加载器 */
export function createArraySkillLoader(skills: Skill[]): SkillLoader {
  return async () => skills;
}
