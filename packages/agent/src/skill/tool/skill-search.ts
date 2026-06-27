// src/skill/tool/skill-search.ts
import {z} from 'zod';
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 搜索工具 */
export function createSkillSearchTool(manager: SkillManager) {
  return createTool({
    name: 'skill_search',
    description: 'Search across all available skills by keyword. Returns matching skills with relevance scores.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().int().default(10).describe('Max results'),
    }),
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { query, limit } = call.args as { query: string; limit: number };
      const results = manager.search(query, limit ?? 10);
      return JSON.stringify(results);
    },
  });
}
