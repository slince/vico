// src/skill/tool/skill-search.ts
import {createTool} from '../../tool/create-tool.js';
import type {SkillManager} from '../skill-manager.js';

/** 创建 skill 搜索工具 */
export function createSkillSearchTool(manager: SkillManager) {
  return createTool({
    name: 'skill_search',
    description: 'Search across all available skills by keyword. Returns matching skills with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    async execute(call) {
      const { query, limit } = call.args as { query: string; limit?: number };
      const results = manager.search(query, limit ?? 10);
      return JSON.stringify(results);
    },
  });
}
