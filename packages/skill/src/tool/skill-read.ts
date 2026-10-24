// @vico/skill - skill_read 工具：读取 Skill 目录内的文件

import { resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import { createTool } from '@vico/tool';
import { localFilesystem, type Filesystem } from '@vico/fs';
import type { SkillRegistry } from '../skill-registry.js';

/**
 * 创建 skill_read 工具 — 读取 Skill 目录下的引用、脚本或资源文件。
 * @param manager - SkillRegistry 实例
 * @param fs - 文件系统实现，默认本地文件系统
 * @returns 配置好的 Tool 对象
 */
export function createSkillReadTool(manager: SkillRegistry, fs: Filesystem = localFilesystem) {
  return createTool({
    name: 'skill_read',
    description: '读取 Skill 的 references、scripts 或 assets 目录中的文件。',
    inputSchema: z.object({
      skillName: z.string().describe('Skill 名称'),
      filePath: z.string().describe('Skill 目录内的相对路径'),
    }),
    outputSchema: z.object({
      content: z.string(),
    }),
    policy: 'auto',
    kind: 'readonly',
    async execute(args) {
      const { skillName, filePath } = args;
      const skill = manager.get(skillName);
      if (!skill) throw new Error(`Skill "${skillName}" not found`);

      const base = resolve(skill.path);
      const fullPath = resolve(base, filePath);
      // 校验路径未越出 Skill 目录（防目录穿越）
      const rel = relative(base, fullPath);
      if (rel === '..' || rel.startsWith(`..${sep}`)) {
        throw new Error(`Invalid path (outside skill directory): ${filePath}`);
      }

      if (!(await fs.exists(fullPath))) throw new Error(`File not found: ${filePath}`);
      try {
        return { content: await fs.readTextFile(fullPath) };
      } catch {
        throw new Error(`Cannot read file: ${filePath} (may be binary)`);
      }
    },
  });
}
