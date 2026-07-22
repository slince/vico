// src/skill/tool/skill-read.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillRegistry} from '../skill-registry.js';

/**
 * 创建 skill 文件读取工具 — 读取 Skill 目录下的引用、脚本或资源文件。
 * @param manager - SkillRegistry 实例
 * @returns 配置好的 Tool 对象
 */
export function createSkillReadTool(manager: SkillRegistry) {
  return createTool({
    name: 'skill_read',
    description: "读取 Skill 的 references、scripts 或 assets 目录中的文件。",
    inputSchema: z.object({
      skillName: z.string().describe('Skill 名称'),
      filePath: z.string().describe('Skill 目录内的相对路径'),
    }),
    outputSchema: z.object({
      content: z.string(),
    }),
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(args) {
      const { skillName, filePath } = args;
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
