import type {Skill, SkillLoader} from "./types.js";

/** 串联多个加载器，按顺序调用并合并结果 */
export function createSkillLoaderChain(loaders: SkillLoader[]): SkillLoader {
  return async () => {
    const allSkills: Skill[] = [];
    for (const loader of loaders) {
      allSkills.push(...await loader());
    }
    return allSkills;
  };
}
