// src/skill/tool/skill-search.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillRegistry} from '../skill-registry.js';

/**
 * 创建 skill 搜索工具 — 按关键词搜索所有可用 Skill。
 * @param manager - SkillRegistry 实例
 * @returns 配置好的 Tool 对象
 */
export function createSkillSearchTool(manager: SkillRegistry) {
  return createTool({
    name: 'skill_search',
    description: '按关键词搜索所有可用 Skill，返回匹配的 Skill 及相关度评分。',
    inputSchema: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().int().default(10).describe('最大结果数'),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        name: z.string(),
        description: z.string(),
        score: z.number(),
      })),
    }),
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { query, limit } = call.args as { query: string; limit: number };
      const results = manager.search(query, limit ?? 10);
      return { results };
    },
  });
}
