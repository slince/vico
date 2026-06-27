// src/skill/tool/skill-load.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 加载工具 */
export function createSkillLoadTool(manager: SkillManager) {
  return createTool({
    name: 'skill',
    description:
      'Load the full instructions for a skill by name. Use this when you need detailed guidance from a specific skill.',
    inputSchema: z.object({
      name: z.string().describe('The skill name to load'),
    }),
    outputSchema: z.object({
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
      references: z.array(z.string()),
      scripts: z.array(z.string()),
      assets: z.array(z.string()),
    }),
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { name } = call.args as { name: string };
      const skill = manager.get(name);
      if (!skill) throw new Error(`Skill "${name}" not found. Available: ${manager.listAll().map((s) => s.name).join(', ')}`);
      return {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        references: skill.references,
        scripts: skill.scripts,
        assets: skill.assets,
      };
    },
  });
}
