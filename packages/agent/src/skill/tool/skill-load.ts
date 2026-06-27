// src/skill/tool/skill-load.ts
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 加载工具 */
export function createSkillLoadTool(manager: SkillManager) {
  return createTool({
    name: 'skill',
    description:
      'Load the full instructions for a skill by name. Use this when you need detailed guidance from a specific skill.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name to load' },
      },
      required: ['name'],
    },
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { name } = call.args as { name: string };
      const skill = manager.get(name);
      if (!skill) return `Skill "${name}" not found. Available: ${manager.listAll().map((s) => s.name).join(', ')}`;
      return JSON.stringify({
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        references: skill.references,
        scripts: skill.scripts,
        assets: skill.assets,
      });
    },
  });
}
