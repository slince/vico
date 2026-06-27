// src/skill/skills-processor.ts
import type { Skill } from './types.js';
import type { SkillManager } from './skill-manager.js';

/**
 * SkillsProcessor — 将可用 Skill 元数据注入系统提示词（提前注入模式）。
 * @param skills - 可用的 Skill 列表
 * @param format - 输出格式，'xml' 或 'json'，默认 'xml'
 * @returns 格式化后的 Skill 目录字符串
 */
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
