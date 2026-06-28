// src/skill/skill-registry.ts
import type {Skill, SkillLoader} from './types.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private loaders: SkillLoader[];
  private roots: string[] = [];

  /**
   * @param loaders - Skill 加载器列表，discover 时依次调用
   */
  constructor(loaders: SkillLoader[]) {
    this.loaders = loaders;
  }

  /**
   * 从指定目录发现并注册 Skill，依次调用所有 loader。
   * @param roots - 待扫描的根目录列表
   * @returns 所有发现的 Skill 列表
   */
  async discover(roots: string[]): Promise<Skill[]> {
    this.roots = roots;
    const allSkills: Skill[] = [];
    for (const loader of this.loaders) {
      const discovered = await loader.discover(roots);
      allSkills.push(...discovered);
    }
    for (const skill of allSkills) {
      this.skills.set(skill.name, skill);
    }
    return allSkills;
  }

  /**
   * 按名称查找 Skill。
   * @param name - Skill 名称
   * @returns 匹配的 Skill，未找到则返回 undefined
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 列出所有已注册的 Skill。
   * @returns Skill 列表
   */
  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 简单关键词搜索 — 匹配 name、description 和 instructions 字段。
   * @param query - 搜索关键词
   * @param limit - 最大返回结果数，默认 10
   * @returns 按相关度评分排序的搜索结果列表
   */
  search(query: string, limit = 10): Array<{ name: string; description: string; score: number }> {
    const q = query.toLowerCase();
    const results: Array<{ name: string; description: string; score: number }> = [];
    for (const skill of this.skills.values()) {
      let score = 0;
      if (skill.name.toLowerCase().includes(q)) score += 10;
      if (skill.description.toLowerCase().includes(q)) score += 5;
      if (skill.instructions.toLowerCase().includes(q)) score += 1;
      if (score > 0) {
        results.push({ name: skill.name, description: skill.description, score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * 直接注册 Skill 实例（数组/内联 Skill）。
   * @param skills - 待注册的 Skill 列表
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * 清除缓存并重新扫描所有 Skill。
   */
  async refresh(): Promise<void> {
    this.skills.clear();
    await this.discover(this.roots);
  }
}
