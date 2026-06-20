/** ManagedSkillStore — 从 SkillManager 按名称检索 Skill 的 SkillStore 实现 */
import type { Skill, SkillStore } from './types.js';
import type { SkillManager } from './skill-manager.js';

/**
 * 基于 SkillManager 的 SkillStore。
 *
 * - 指定名称时：从 manager 中检索对应 skill，未找到的静默跳过
 * - 名称列表为空时：返回 manager 中全部 skill
 */
export class ManagedSkillStore implements SkillStore {
  constructor(
    private readonly manager: SkillManager,
    private readonly names?: string[],
  ) {}

  async load(): Promise<Skill[]> {
    if (!this.names || this.names.length === 0) {
      return this.manager.listAll();
    }
    const result: Skill[] = [];
    for (const name of this.names) {
      const skill = this.manager.get(name);
      if (skill) result.push(skill);
    }
    return result;
  }
}
