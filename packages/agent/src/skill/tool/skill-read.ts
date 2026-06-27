// src/skill/tool/skill-read.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 文件读取工具 */
export function createSkillReadTool(manager: SkillManager) {
  return createTool({
    name: 'skill_read',
    description: "Read a file from a skill's references, scripts, or assets directory.",
    inputSchema: z.object({
      skillName: z.string().describe('The skill name'),
      filePath: z.string().describe('Relative path within the skill directory'),
    }),
    outputSchema: z.object({
      content: z.string(),
    }),
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { skillName, filePath } = call.args as { skillName: string; filePath: string };
      const skill = manager.get(skillName);
      if (!skill) throw new Error(`Skill "${skillName}" not found`);
      const fullPath = resolve(skill.path, filePath);
      if (!existsSync(fullPath)) throw new Error(`File not found: ${filePath}`);
      try {
        return { content: readFileSync(fullPath, 'utf-8') };
      } catch {
        throw new Error(`Cannot read file: ${filePath} (may be binary)`);
      }
    },
  });
}
