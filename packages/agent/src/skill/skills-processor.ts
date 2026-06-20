// src/skill/skills-processor.ts
import type { Skill } from './skill-loader.js';
import type { SkillManager } from './skill-manager.js';

/** SkillsProcessor — 将可用 Skill 元数据注入系统提示词（提前注入模式） */
export function formatSkillCatalog(skills: Skill[], format: 'xml' | 'json' = 'xml'): string {
  if (skills.length === 0) return '';

  if (format === 'json') {
    const list = skills.map((s) => ({ name: s.name, description: s.description }));
    return `<available_skills>\n${JSON.stringify(list, null, 2)}\n</available_skills>`;
  }

  // XML 格式（默认）
  const items = skills.map(
    (s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`,
  );
  return `<available_skills>\n${items.join('\n')}\n</available_skills>`;
}
