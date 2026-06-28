// src/skill/array-skill-loader.ts
import type {Skill, SkillLoader} from './types.js';

/** 数组 Skill 加载器 — 直接从内存中的 Skill 数组加载 */
export class ArraySkillLoader implements SkillLoader {
  private skills: Skill[];

  /** @param skills - 待加载的 Skill 数组 */
  constructor(skills: Skill[]) {
    this.skills = skills;
  }

  async load(): Promise<Skill[]> {
    return this.skills;
  }
}
