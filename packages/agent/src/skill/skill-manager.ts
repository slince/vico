// src/skill/skill-manager.ts
import type {Skill} from './types.js';
import type {FSSkillLoader} from './fs-skill-loader.js';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private loader: FSSkillLoader;
  private roots: string[] = [];

  constructor(loader: FSSkillLoader) {
    this.loader = loader;
  }

  async discover(roots: string[]): Promise<void> {
    this.roots = roots;
    const discovered = await this.loader.discover(roots);
    for (const skill of discovered) {
      this.skills.set(skill.name, skill);
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 简单关键词搜索 — 匹配 name 和 description */
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

  async refresh(): Promise<void> {
    this.skills.clear();
    await this.discover(this.roots);
  }
}
