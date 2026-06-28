// src/skill/tool/skill-load.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillRegistry} from '../skill-registry.js';

/**
 * 创建 skill 加载工具 — 按名称加载 Skill 的完整指令集。
 * @param manager - SkillRegistry 实例
 * @returns 配置好的 Tool 对象
 */
export function createSkillLoadTool(manager: SkillRegistry) {
  return createTool({
    name: 'skill',
    description:
      '按名称加载 Skill 的完整指令集。当需要某个 Skill 的详细指导时使用。',
    inputSchema: z.object({
      name: z.string().describe('要加载的 Skill 名称'),
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
    async execute(args) {
      const { name } = args;
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
