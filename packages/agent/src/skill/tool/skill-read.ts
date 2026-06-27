// src/skill/tool/skill-read.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 文件读取工具 */
export function createSkillReadTool(manager: SkillManager) {
  return createTool({
    name: 'skill_read',
    description: "Read a file from a skill's references, scripts, or assets directory.",
    inputSchema: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'The skill name' },
        filePath: { type: 'string', description: 'Relative path within the skill directory' },
      },
      required: ['skillName', 'filePath'],
    },
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { skillName, filePath } = call.args as { skillName: string; filePath: string };
      const skill = manager.get(skillName);
      if (!skill) return `Skill "${skillName}" not found`;
      const fullPath = resolve(skill.path, filePath);
      if (!existsSync(fullPath)) return `File not found: ${filePath}`;
      try {
        return readFileSync(fullPath, 'utf-8');
      } catch {
        return `Cannot read file: ${filePath} (may be binary)`;
      }
    },
  });
}
