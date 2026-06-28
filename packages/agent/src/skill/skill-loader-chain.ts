import {Skill, SkillLoader} from "./types.js";

/** Skill 加载器链 — 聚合多个 loader，按顺序调用并合并结果 */
export class SkillLoaderChain implements SkillLoader {
  private loaders: SkillLoader[];

  /** @param loaders - SkillLoader 列表 */
  constructor(loaders: SkillLoader[]) {
    this.loaders = loaders;
  }

  async load(): Promise<Skill[]> {
    const allSkills: Skill[] = [];
    for (const loader of this.loaders) {
      const skills = await loader.load();
      allSkills.push(...skills);
    }
    return allSkills;
  }
}
