// @vico/skill - skill_list 工具：列出所有可用 Skill

import { z } from 'zod';
import { createTool } from '@vico/tool';
import type { SkillRegistry } from '../skill-registry.js';

/**
 * 创建 skill_list 工具 — 列出所有可用 Skill 及其描述，供 LLM 发现可调用的能力。
 * @param manager - SkillRegistry 实例
 * @returns 配置好的 Tool 对象
 */
export function createSkillListTool(manager: SkillRegistry) {
  return createTool({
    name: 'skill_list',
    description: '列出所有可用的 Skill 及其描述，用于发现可调用的能力。',
    inputSchema: z.object({}),
    outputSchema: z.object({
      skills: z.array(z.object({
        name: z.string(),
        description: z.string(),
      })),
    }),
    policy: 'auto',
    kind: 'readonly',
    async execute() {
      const skills = manager.listAll().map((s) => ({ name: s.name, description: s.description }));
      return { skills };
    },
  });
}
